import os
from flask import Flask, request, jsonify, Response
from slack_sdk import WebClient
from kafka import KafkaProducer, KafkaConsumer
from datetime import datetime, timedelta
from flask_cors import CORS
import schedule
import time
import threading
import json
from collections import defaultdict

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "http://localhost:3000"}})

# ------------------------------------------------
# Configuration
# (Replace with your real Slack credentials)
# ------------------------------------------------
SLACK_SIGNING_SECRET = "YOUR_SIGNING_SECRET"
SLACK_BOT_TOKEN = "YOUR_BOT_TOKEN"
BOOTSTRAP_SERVERS = 'localhost:9092'  # Redpanda or Kafka broker
TOPIC_NAME = 'slack-events'

# ------------------------------------------------
# Global state
# ------------------------------------------------
producer = KafkaProducer(bootstrap_servers=BOOTSTRAP_SERVERS)
monthly_messages = 0            # Tracks # of messages this month
active_members = 0             # Tracks # of new members (30d window)
last_reset = datetime.now()     # Timestamp of last reset
message_counts = defaultdict(int)  # user -> # of messages

def transform_event(event):
    """
    Convert raw Slack event into a standardized dict with a 'metric_type' field.
    We do NOT modify global counters here; that happens in slack_events().
    """
    event_type = event.get("type", "unknown")

    if event_type == "team_join":
        user = event.get("user", {}).get("id", "unknown")
    else:
        user = event.get("user", "unknown")

    return {
        "event_type": event_type,
        "user": user,
        "channel": event.get("channel", "unknown"),
        "text": event.get("text", ""),
        "timestamp": event.get("event_ts", datetime.now().timestamp()),
        "metric_type": (
            "message_count" if event_type == "message" else
            "channel_count" if event_type == "channel_created" else
            "member_count" if event_type == "team_join" else
            "unknown"
        )
    }

@app.route('/slack-events', methods=['POST'])
def slack_events():
    """
    Slack will POST event payloads here. We'll:
      1) Transform the event
      2) Increment relevant counters
      3) Produce the event to Redpanda
      4) Return JSON success
    """
    global monthly_messages, active_members

    data = request.json
    # Slack URL verification handshake
    if data.get("type") == "url_verification":
        return jsonify({"challenge": data["challenge"]})

    # Get the "event" key from Slack's JSON
    raw_event = data.get("event", {})
    transformed = transform_event(raw_event)

    # Update counters
    if transformed["metric_type"] == "message_count":
        monthly_messages += 1
        message_counts[transformed["user"]] += 1
    elif transformed["metric_type"] == "member_count":
        active_members += 1

    # Send to Redpanda
    producer.send(TOPIC_NAME, value=json.dumps(transformed).encode('utf-8'))

    return jsonify({"status": "success"}), 200

@app.route('/metrics', methods=['GET'])
def get_metrics():
    """
    Returns the monthly_messages, active_members, and the last reset time.
    The frontend uses these to initialize certain counters.
    """
    return jsonify({
        "monthly_messages": monthly_messages,
        "active_members": active_members,
        "last_reset": last_reset.isoformat()
    })

@app.route('/leaderboard', methods=['GET'])
def get_leaderboard():
    """
    Returns the top 10 users by message count.
    """
    sorted_users = sorted(message_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    return jsonify({"leaderboard": dict(sorted_users)})

@app.route('/slack-events-stream')
def slack_events_stream():
    """
    SSE endpoint that consumes from Redpanda (Kafka)
    and streams out each event in real time.
    """
    def generate_events():
        consumer = KafkaConsumer(
            TOPIC_NAME,
            bootstrap_servers=BOOTSTRAP_SERVERS,
            auto_offset_reset='earliest',
            enable_auto_commit=False
        )
        for message in consumer:
            try:
                event_data = json.loads(message.value.decode('utf-8'))
                # SSE format requires "data: ..." plus a blank line.
                yield f"data: {json.dumps(event_data)}\n\n"
            except Exception as err:
                print(f"Error streaming event: {err}")
    return Response(generate_events(), mimetype="text/event-stream")

def reset_counters():
    """
    Reset monthly messages, active members, and message_counts every 30 days.
    """
    global monthly_messages, active_members, message_counts, last_reset
    monthly_messages = 0
    active_members = 0
    message_counts = defaultdict(int)
    last_reset = datetime.now()

def scheduler():
    """
    Background thread that runs the scheduled jobs (like a cron).
    """
    schedule.every(30).days.do(reset_counters)
    while True:
        schedule.run_pending()
        time.sleep(1)

if __name__ == '__main__':
    threading.Thread(target=scheduler, daemon=True).start()
    app.run(port=8000, debug=True)
