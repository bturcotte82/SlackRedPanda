# Slack Community Live Metric Dashboard - Built with Redpanda 🔴🐼

### Are you the owner of an online community based in Slack? 

### Is this (⬇️) you?

<img src="https://github.com/user-attachments/assets/ccad9635-5221-488e-89d3-d7df0f6fc484" alt="using-the-computer-tim-robinson" width="300">

__________________________________
Let's change that. 

This repository contains a simple application that allows you to quickly and locally deploy a Slack Community Dashboard that updates in real time when users in your workspace:

- Send a message
- Join the workspace
- Interact with other users. 

The dashboard contains the following (continuously updated) metrics:

- **Total Messages**
- **Rolling 30-Day Message count**
- **Rolling 30-day New User count**
- **Community Health Score** (proprietary algorithm)
- **Recent Activity** (with hyperlinks to the user's profile)
- **Engagement leaderboard** (top contributors over 30 day period)

### It looks like this when it's running in a browser:

<img width="500" alt="410449470-86d84ecf-ac71-4036-adcc-71b6bfdfb1c2" src="https://github.com/user-attachments/assets/1b7c903b-2ffc-4f19-b4c8-f3ec5c1d3d94" />

_______________________________________

### Here's a map of how the data is produced, consumed, and displayed on the frontend:

![image-2](https://github.com/user-attachments/assets/36a2abb3-43b4-489b-ab2d-28d38e5fe57b)

The application is designed to run from your CLI in your local environment.

______________
## Prerequisites and Setup
### 1.1 Requirements:
- Docker (20.10.21 or higher) to run Redpanda
- Python 3.10+ for our Flask backend
- Pip (and optionally virtualenv) to install Python dependencies
- Node.js & npm (or yarn) for the React frontend
- Text editor
- Ngrok

### **Download this repository on your local environment:**
- Run ```git clone https://github.com/bturcotte82/SlackRedPanda```
- The files app.py (apps>backend>app.py) and app.js (apps>frontend>app.js) are marked up with comments explaining what each line/method accomplishes - if you care to look!

### 1.2 Getting Redpanda Running

Pull and run Redpanda via Docker:

```
docker run -d --name=redpanda --rm \
  -p 9092:9092 \
  -p 9644:9644 \
  docker.vectorized.io/vectorized/redpanda:latest \
  redpanda start \
  --advertise-kafka-addr localhost \
  --overprovisioned \
  --smp 1  \
  --memory 1G \
  --reserve-memory 500M \
  --node-id 0 \
  --check=false
```

Check to make sure it's there:
```
docker exec -it redpanda rpk cluster info
```

Create a Redpanda topic:
```
docker exec -it redpanda \
  rpk topic create slack-events
```

You should see this response:
```
TOPIC         STATUS
slack-events  OK
```

__________________
### Set Up Your Slack Bot and App

In order for the application to receive events from Slack, we have to create a Slack App that will send events, in JSON format, via the Slack Events API:

- Create a new Slack app at https://api.slack.com/apps
- Click “Create New App,” choose “From scratch,” name it something like “SlackPanda Monitor,” and select the Slack workspace you want to use.

- Grab Credentials:
  - Under “Basic Information,” collect your Signing Secret (you’ll need that in your Flask app).
  - Find the option on the main menu to "Install the App" to your workspace, which will allow you to retrieve a 'Bot User OAuth Token' (also needed by the backend).
- Enable Event Subscriptions (Events API)
  - Open app.py (from the "backend" folder") and add the Signing Secret you collected from Slack:
  <img width="382" alt="Screenshot 2025-02-06 at 9 40 10 PM" src="https://github.com/user-attachments/assets/9420388f-ad99-4f25-bcc5-aeff24ebc2ac" />

  - In your Slack app settings, go to “Event Subscriptions." Toggle it ON, then set the “Request URL” to your publicly accessible endpoint for /slack-events:
    - Run ```ngrok http 8000``` from the CLI in the directory where you saved the project. Copy the https URL, and  paste it in the Slack Request URL field followed by /slack-events. (it will look something like ``` https://XYZ.ngrok.io/slack-events ```).
  - Slack will ping that URL with a "challenge event" to verify. The Flask code will respond with the challenge, and Slack will verify your Request URL
- Select events to subscribe to:
  - Under “Subscribe to bot events”, add these events:
    - channel_created
    - member_joined_channel
    - message.channels
    - message.im
    - team_join
- Grab your Bot Token and paste it into the correct location in app.py:
  - Go to OAuth & Permissions > Bot User OAuth Token > Copy

Now, Slack will automatically send JSON events to our backend server (/slack-events route) whenever something new happens — like a new message or a new member.


__________________

## The Backend (Flask + Redpanda)

### First, Why Redpanda?

You may be wondering why it's necessary to include Redpanda in this application. 

Why can't you just create a simple Slack → Flask event flow?

There are several advantages to implementing Redpanda here:

- **Decoupling**: Multiple consumers can read Slack events without interfering. This would be especially helpful if you had different dashboards, or if your community was spread across additional platforms outside of Slack, and you wanted to incorporate external metrics into the system.
- **Persistence**: Slack events are stored in a log. Since this is a locally-hosted application, if your frontend restarts, the application can replay them.
- **Scalability**: The in-memory queue may not be able to handle a large, highly-active community as well as Redpanda.
- **Speed**: Redpanda boasts [industry-leading performance](https://www.redpanda.com/guides/kafka-performance).

3.2 Installing and Running the Backend

Run this from your CLI in the project directory:
```
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
python app.py
```

Go to http://localhost:8000/metrics in your browser where you should see this JSON response:
```
json
Copy
Edit
{
  "monthly_messages": 0,
  "active_members": 0,
  "last_reset": "2025-01-01T00:00:00"
}
```

3.3 Quick Tests

If you run ```docker exec -it redpanda rpk topic consume slack-events```, you can watch the events appear in Redpanda as Slack sends them through your application. 

Trying posting a message in your Slack channel, or invite a friend to join. 

You should see a JSON message with metric_type: "message_count" or metric_type: "member_count" show up. Your Slack events are streaming!




____________

## The Frontend (React)
4.1 Installing Frontend Dependencies
```
cd ../frontend
npm install
```
This sets up React, react-native-sse, etc.


### How It Works:
App.js connects to <http://localhost:8000/slack-events-stream> with SSE (Server-Sent Events). 

That endpoint is actually a Kafka consumer (pointed at Redpanda) that relays Slack events in real time. 

The React app will perform the following:
- Tracks total messages (all-time since the app loaded), messages (30d), new members (30d), and a live recent messages feed.
- Shows a “Community Health” score that increases with engagement or  decreases if there are no new messages for 30+ minutes.
- Color-codes the health metric (red/yellow/green) based on value and lists top contributors.
- Shows “Redpanda: Connected/Disconnected” status banner
  - Uses a React eventlistener to determine if the SSE connection is open.
  - In other words, it checks to see if there are events streaming from the backend - which can only happen once the events have been consumed from Redpanda. 


## Running the Frontend

Navigate to the frontend directory in the project folder and run:
```
npm start
```

Copy ```http://localhost:3000``` into your browser (if it doens't automatically open), and behold the glory of what we have created!

You should see:

- Metric meters for total messages, messages (30d), community health, new members (30d)
- A scrollable “Recent Activity” feed (empty at first)
- A “Top Contributors” list
- A banner that says “Redpanda: Connected ✅” if the SSE link is up











____________________

## In Summary

At this point you may have a better understanding of that wild map I drew at the beginning of this essay.

Here's what's happening in your newly running application:

- Slack hits your endpoint at /slack-events whenever something happens in your workspace.
- The Flask backend receives the event, performs some of my proprietery transforms, and produces to the Redpanda slack-events topic.
- Flask also has a consumer to read that same topic from Redpanda and stream it to the frontend application that is built with React.
- React automatically updates the community health, top contributors, etc. after making a few slight data manipulations to ensure that the metrics come out clean and aesthetic. 
- If you see your health score dip, it means that there hasn't been a new message in 30 minutes.
- If you're Health Score is green, that means that your Community is thriving (according to me).
  - Here is the algorithm for Community Health which I arbitrarily hardcoded into the React script:
```
useEffect(() => {
  const interval = setInterval(() => {
    if (lastMessageTime) {
      const halfHour = 30 * 60 * 1000; // 30 minutes
      const now = Date.now();

      // 1) Check if more than 30 min have passed without a new message
      if (now - lastMessageTime > halfHour) {
        // 2) Decrease health score by 1, but not below 0
        setHealthScore(prev => {
          let newVal = parseFloat(prev) - 1;
          if (newVal < 0) newVal = 0;
          return newVal.toFixed(1);
        });

        // 3) Reset lastMessageTime so we only subtract once
        setLastMessageTime(null);
      }
    }
  }, 60000); // 4) This runs every minute

  return () => clearInterval(interval);
}, [lastMessageTime]);
```
  - This will calculate positive accumulations to the score. The ```useEffect``` hook contains logic that listens for changes in the metrics like monthly messages and new members. It assigns 0.5 points to the total score for a new message, and 1 point for a new member.
  - The score is capped at a maximum of 200
  - That said, the Community Health formula wouldn't be nearly as effective if it only _added_ value to the score.
```
useEffect(() => {
  const interval = setInterval(() => {
    if (lastMessageTime) {
      const halfHour = 30 * 60 * 1000; // 30 minutes
      const now = Date.now();

      // 1) Check if more than 30 min have passed without a new message
      if (now - lastMessageTime > halfHour) {
        // 2) Decrease health score by 1, but not below 0
        setHealthScore(prev => {
          let newVal = parseFloat(prev) - 1;
          if (newVal < 0) newVal = 0;
          return newVal.toFixed(1);
        });

        // 3) Reset lastMessageTime so we only subtract once
        setLastMessageTime(null);
      }
    }
  }, 60000); // 4) This runs every minute

  return () => clearInterval(interval);
}, [lastMessageTime]);
```
  - This section is responsible for deducting points based on inactivity. If the logic detects that there has not been a new message in the last 30 minutes, a point is deducted from the score.
  - As a fun little _extra_, the Health Score also changes colors based on its value:
   - Red if the score is below 100
   - Yellow if it is between 100 and 150
   - Green if it gets above 150

- Of course, every organization will have different standards and metrics for community health, so feel free to alter this algorithm as you see fit!
  - For example, my shrimpy test community has 3 users - If your community has 10,000, the score will exceed 200 in hours, if not minutes.

____________

### Troubleshooting (Addressing the stuff that momentarily confused me when I was building this)
- **Slack App**: _Make sure_ you added the correct events (like message.channels) and set the “Request URL” to your publicly accessible https://xyz.ngrok.io/slack-events.
  - The Slack verification process can be tricky. You need to have the backend app.py running, so you can receive Slack's ```challenge``` request. This is why you must download the backend app.py script and inject your Slack Signing Secret _before_ you install the Slack app.
- **Flask**: Confirm http://localhost:8000/metrics returns JSON. If not, the server might not be running or there’s a port conflict. (I suggested using port 8000 because on Macs, the standard port 5000 is often occupied by some confusing Mac stuff, but feel free to use any open port you wish).
- **Redpanda**: Use ```docker logs redpanda``` or ```rpk cluster info``` to confirm that it’s up and not throwing errors. Also, run ```rpk topic consume slack-events``` to see raw data.
- **React**: If your SSE status says “Disconnected,” open your browser’s console to see if there’s a network error. It's possible that the Flask endpoint is not on localhost:8000, or it’s blocked by CORS.



_______________

## What makes this application different than other similar tools?

- **Redpanda streaming data**
  - **Real-time streaming** of Slack events to your UI:
    - Traditional tools may use batch-imported data loads which are not reflected in real time.
  - **Reliable data capture** if you want to add more analytics, machine learning, or store events for later.
    - One idea could be a "Sentiment Score":
      - You could add a function that passes message data into an language model such as ChatGPT, and return a sentiment assessment.
      - Then, you could have a live "Sentiment Score" that shows the aggregated emotional sentiment of all messages, allowing you to assess the general satisfaction of your community.
  - **Simplicity**:
    -  As you can see in the script, Redpanda is Kafka-compatible, so kafka-python just works with no extra steps.
-  **Performance**:
  -  An ordinary batch-processing tool can probably handle my shrimpy test community without any major issues, but a real, lively community would benefit significantly from the speed and processing ability that Redpanda affords in the application stack.
