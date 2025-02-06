import { useState, useEffect } from 'react';
import EventSource from 'react-native-sse';
import './App.css';

function App() {
  const SLACK_WORKSPACE = "brianturcottegroup"; // Replace with your Slack workspace name
  const [metrics, setMetrics] = useState({
    totalMessages: 0,      // all-time messages since the app loaded
    monthlyMessages: 0,    // 30d message
    activeMembers: 0,      // new members 30d
    recentMessages: []
  });
  const [leaderboard, setLeaderboard] = useState({});
  const [healthScore, setHealthScore] = useState(100);
  const [isConnected, setIsConnected] = useState(false);  // Redpanda "connection" status
  const [lastMessageTime, setLastMessageTime] = useState(null);

  // Load data from the backend
  // ---------------------------------
  useEffect(() => { //Get monthly messages and active members)
    fetch('http://localhost:8000/metrics')
      .then(res => res.json()) //convert to JSON
      .then(data => {
        setMetrics(prev => ({
          ...prev,
          monthlyMessages: data.monthly_messages || 0, //update monthly messages and active member in the metrics state
          activeMembers: data.active_members || 0,
          totalMessages: data.monthly_messages || 0


        }));
      });

    // Get the leaderboard
    const updateLeaderboard = () => {
      fetch('http://localhost:8000/leaderboard')
        .then(res => res.json())
        .then(data => {
          setLeaderboard(data.leaderboard || {}); //store leaderboard data in leaderboard state
        });
    };
    updateLeaderboard();

    // Refresh leaderboard every 30s
    const interval = setInterval(updateLeaderboard, 30000);
    return () => clearInterval(interval);
  }, []);

  // 2. SSE connection for real-time Slack events
  // -------------------------
  useEffect(() => {
    const sse = new EventSource('http://localhost:8000/slack-events-stream');

    // Mark connected if SSE stream opens
    sse.addEventListener('open', () => {
      setIsConnected(true);
      console.log("Connected to Redpanda via SSE");
    });

    // Listens for new SSE messages
    sse.addEventListener('message', (e) => {
      try {
        const event = JSON.parse(e.data); //converts JSON data to a JavaScript object
        setMetrics(prev => { //updates metrics state, and define logic for increasing counters or updating recent messages feed
          const isMessage = (event.metric_type === 'message_count');
          const isNewMember = (event.metric_type === 'member_count');

          // If it is a message, note the current timestamp
          if (isMessage) {
            setLastMessageTime(Date.now());
          }

          // Insert new event at the *top* of recentMessages 
          // keep only the 10 most recent
          const updatedActivity = [event, ...prev.recentMessages].slice(0, 10);

          return { //return updated object and increment counters if necessary
            ...prev,
            totalMessages: prev.totalMessages + (isMessage ? 1 : 0),
            monthlyMessages: prev.monthlyMessages + (isMessage ? 1 : 0),
            activeMembers: prev.activeMembers + (isNewMember ? 1 : 0),
            recentMessages: updatedActivity
          };
        });
      } catch (err) {
        console.error("Parse error:", err);
      }
    });

    // Return disconnected on SSE error
    sse.addEventListener('error', () => {
      setIsConnected(false);
      console.log("SSE connection error");
    });

    // Close event source to avoid memory leaks on load
    return () => sse.close();
  }, []);

  //Calculate community health score
  // -------------------------
  useEffect(() => {
    // start at 100, +0.5 per monthly message, +1 per new member
    const score = 100
      + (metrics.monthlyMessages * 0.5)
      + (metrics.activeMembers * 1);

    // Cap at 200
    setHealthScore(prev => {
      const capped = Math.min(score, 200);
      return capped.toFixed(1);
    });
  }, [metrics.monthlyMessages, metrics.activeMembers]);

  
  // Decrease health if no new messages for 30 min
  // -------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastMessageTime) {
        const halfHour = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();
        if (now - lastMessageTime > halfHour) {
          // Decrease health by 1, but don't go below 0
          setHealthScore(prev => {
            let newVal = parseFloat(prev) - 1;
            if (newVal < 0) newVal = 0;
            return newVal.toFixed(1);
          });
          // Reset lastMessageTime so we only subtract once
          setLastMessageTime(null);
        }
      }
    }, 60000); // check every minute

    return () => clearInterval(interval);
  }, [lastMessageTime]);

  // Change color based on health score
  // -------------------------
  const numericalHealth = parseFloat(healthScore);
  let healthColorClass = 'health-bad';  // default 
  if (numericalHealth >= 100 && numericalHealth <= 150) {
    healthColorClass = 'health-medium'; //new color if score is greater than 100
  } else if (numericalHealth > 150) { //new color if score is greater than
    healthColorClass = 'health-good';
  }

  return (
    <div className="dashboard">
      {/* Redpanda connection banner */}
      <div className={`connection-banner ${isConnected ? 'connected' : 'disconnected'}`}>
        Redpanda: {isConnected ? 'Connected ✅' : 'Disconnected ❌'}
      </div>

      <h1>SlackPanda Community Monitor</h1>

      {/* Metrics row (4 boxes in a row) */}
      <div className="metrics-row">
        {/* (1) Total Messages (GREEN) */}
        <div className="metric-box">
          <h3>Total Messages</h3>
          <p className="stat stat-green">{metrics.totalMessages}</p>
        </div>

        {/* (2) Messages (30d) (GREEN) */}
        <div className="metric-box">
          <h3>Messages (30d)</h3>
          <p className="stat stat-green">{metrics.monthlyMessages}</p>
        </div>

        {/* (3) Community Health (with dynamic color) */}
        <div className="metric-box">
          <h3>Community Health</h3>
          <p className={`stat ${healthColorClass}`}>{healthScore}/200</p>
        </div>

        {/* (4) New Members (30d)  */}
        <div className="metric-box">
          <h3>New Members (30d)</h3>
          <p className="stat stat-green">{metrics.activeMembers}</p>
        </div>
      </div>

      {/* Recent Activity (scrollable, newest at top) */}
      <div className="recent-activity">
        <h2>Recent Activity</h2>
        <ul>
          {metrics.recentMessages.map((msg, idx) => (
            <li key={idx} className="activity-item">
              <a
                href={`https://${SLACK_WORKSPACE}.slack.com/team/${msg.user}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {msg.user || "Unknown user"}
              </a>
              : {msg.text ? msg.text.substring(0, 50) : ""}
              {msg.text && msg.text.length > 50 ? "..." : ""}
            </li>
          ))}
        </ul>
      </div>

      {/* Top Contributors */}
      <div className="leaderboard-section">
        <h2>Top Contributors</h2>
        <div className="leaderboard">
          {Object.entries(leaderboard).map(([user, count], index) => (
            <div key={user} className="leaderboard-item">
              <span className="rank">#{index + 1}</span>
              <a
                href={`https://${SLACK_WORKSPACE}.slack.com/team/${user}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {user}
              </a>
              <span className="count">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
