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

app = Flask(__name__) #creates main Flask application
CORS(app, resources={r"/*": {"origins": "http://localhost:3000"}}) #Configures app to allow browser requests on local host

# Replace below with your actual Slack Credentials:
# ------------------------------------------------
SLACK_SIGNING_SECRET = "YOUR_SIGNING_SECRET"
SLACK_BOT_TOKEN = "YOUR_BOT_TOKEN"
BOOTSTRAP_SERVERS = 'localhost:9092'  # Redpanda server location
TOPIC_NAME = 'slack-events' #Redpanda topic that we will send Slack event data to

# Global
# ----------------------------------------------
producer = KafkaProducer(bootstrap_servers=BOOTSTRAP_SERVERS) #creates a connection to Redpanda
monthly_messages = 0  # Tracks messages in 30 day period
active_members = 0  #Tracks new members over a 30 day period
last_reset = datetime.now()  # Holds date and time of last 30 day reset period
message_counts = defaultdict(int)  #dictionary that starts every individual user's message count at 0. Stores USER ID and # messages for each user


# Function that reorganizes raw Slack data (JSON) and stores it in a more convenient way
#----------------------------------------------------------
def transform_event(event):
    
    event_type = event.get("type", "unknown") #Reads Slack event type (message vs join)

    if event_type == "team_join":
        user = event.get("user", {}).get("id", "unknown") #Function to label user with userID or unknown if not available
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
        ) #returns a dictionary containing notable event data (formating the data)
    }

@app.route('/slack-events', methods=['POST']) #defines a web address that slack hits with new data
def slack_events():
    
    global monthly_messages, active_members #preparing to change these variables

    data = request.json # Slack URL verification handshake
    if data.get("type") == "url_verification":
        return jsonify({"challenge": data["challenge"]})

    # Getting the event key from Slack's JSON event
    raw_event = data.get("event", {})
    transformed = transform_event(raw_event) #transforms the raw slack event to our own version of an event via the above transform function

    # Updating counters
    if transformed["metric_type"] == "message_count":
        monthly_messages += 1
        message_counts[transformed["user"]] += 1
    elif transformed["metric_type"] == "member_count":
        active_members += 1

    # Sending transformed event to Redpanda's slack-events topic. First, the Python dictionary event is converted to JSON string and then to bytes.
    producer.send(TOPIC_NAME, value=json.dumps(transformed).encode('utf-8'))

    return jsonify({"status": "success"}), 200 #telling Slack the event was received and there were no problems.

@app.route('/metrics', methods=['GET']) #A separate app route that allows the frontend to check the metric totals and reset time
def get_metrics():
    
    return jsonify({
        "monthly_messages": monthly_messages,
        "active_members": active_members,
        "last_reset": last_reset.isoformat()
    })

@app.route('/leaderboard', methods=['GET']) #Another endpoint for the frontend to get top contributors
def get_leaderboard():
    
    sorted_users = sorted(message_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    return jsonify({"leaderboard": dict(sorted_users)})

@app.route('/slack-events-stream') #Defines SSE endpoint to consume from Redpandaaand stream to frontend
def slack_events_stream():
    
    def generate_events(): #read from RedPanda)
        consumer = KafkaConsumer(
            TOPIC_NAME,
            bootstrap_servers=BOOTSTRAP_SERVERS,
            auto_offset_reset='earliest', #if no saved position, start from beginning of topic
            enable_auto_commit=False #Read continuously
        )
        for message in consumer: #Take bytes of consumed message, turn into string, and parse JSON.
            try:
                event_data = json.loads(message.value.decode('utf-8')) #SSE format requires "data: ..." and then a blank line
                yield f"data: {json.dumps(event_data)}\n\n" #yield means send data continuously wihtout ending response
            except Exception as err:
                print(f"Error streaming event: {err}")
    return Response(generate_events(), mimetype="text/event-stream") #Send ongoing stream to frontend

def reset_counters(): #reset the monthly metrics every 30 days
   
    global monthly_messages, active_members, message_counts, last_reset
    monthly_messages = 0
    active_members = 0
    message_counts = defaultdict(int)
    last_reset = datetime.now()

def scheduler(): #scheduler that runs reset_counters() every 30 days
    
    schedule.every(30).days.do(reset_counters)
    while True:
        schedule.run_pending()
        time.sleep(1)

if __name__ == '__main__':
    threading.Thread(target=scheduler, daemon=True).start()
    app.run(port=8000, debug=True) #run the app
