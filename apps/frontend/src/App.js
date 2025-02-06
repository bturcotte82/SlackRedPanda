import { useState, useEffect } from 'react';
import EventSource from 'react-native-sse';
import './App.css';

function App() {
  const SLACK_WORKSPACE = "brianturcottegroup"; // Replace with your workspace
  const [metrics, setMetrics] = useState({
    totalMessages: 0,      // all-time messages since app load
    monthlyMessages: 0,    // (30d)
    activeMembers: 0,      // new members (30d)
    recentMessages: []
  });
  const [leaderboard, setLeaderboard] = useState({});
  const [healthScore, setHealthScore] = useState(100);
  const [isConnected, setIsConnected] = useState(false);  // Redpanda connection status
  const [lastMessageTime, setLastMessageTime] = useState(null);

  // -------------------------
  // 1. Load initial data from backend
  // -------------------------
  useEffect(() => {
    // Fetch monthlyMessages and activeMembers
    fetch('http://localhost:8000/metrics')
      .then(res => res.json())
      .then(data => {
        setMetrics(prev => ({
          ...prev,
          monthlyMessages: data.monthly_messages || 0,
          activeMembers: data.active_members || 0
        }));
      });

    // Fetch leaderboard
    const updateLeaderboard = () => {
      fetch('http://localhost:8000/leaderboard')
        .then(res => res.json())
        .then(data => {
          setLeaderboard(data.leaderboard || {});
        });
    };
    updateLeaderboard();

    // Refresh leaderboard every 30s
    const interval = setInterval(updateLeaderboard, 30000);
    return () => clearInterval(interval);
  }, []);

  // -------------------------
  // 2. SSE connection for real-time Slack events
  // -------------------------
  useEffect(() => {
    const sse = new EventSource('http://localhost:8000/slack-events-stream');

    // Mark connected if SSE stream opens
    sse.addEventListener('open', () => {
      setIsConnected(true);
      console.log("Connected to Redpanda via SSE");
    });

    // Handle new SSE messages
    sse.addEventListener('message', (e) => {
      try {
        const event = JSON.parse(e.data);
        setMetrics(prev => {
          const isMessage = (event.metric_type === 'message_count');
          const isNewMember = (event.metric_type === 'member_count');

          // If this is a message, store the current timestamp
          if (isMessage) {
            setLastMessageTime(Date.now());
          }

          // Insert new event at the *top* of recentMessages 
          // and keep only the 10 most recent
          const updatedActivity = [event, ...prev.recentMessages].slice(0, 10);

          return {
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

    // Mark disconnected on SSE error
    sse.addEventListener('error', () => {
      setIsConnected(false);
      console.log("SSE connection error");
    });

    // Cleanup on unmount
    return () => sse.close();
  }, []);

  // -------------------------
  // 3. Calculate community health score
  // -------------------------
  useEffect(() => {
    // Base formula: start at 100, +0.5 per monthly message, +1 per new member
    const score = 100
      + (metrics.monthlyMessages * 0.5)
      + (metrics.activeMembers * 1);

    // Cap at 200
    setHealthScore(prev => {
      const capped = Math.min(score, 200);
      return capped.toFixed(1);
    });
  }, [metrics.monthlyMessages, metrics.activeMembers]);

  // -------------------------
  // 4. Decrease health if no new messages for 30 min
  //    (Example logic: lose 1 point if 30 min passes with no new messages)
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

  // -------------------------
  // 5. Determine color based on health score
  // -------------------------
  const numericalHealth = parseFloat(healthScore);
  let healthColorClass = 'health-bad';  // default
  if (numericalHealth >= 100 && numericalHealth <= 150) {
    healthColorClass = 'health-medium';
  } else if (numericalHealth > 150) {
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

        {/* (3) Community Health (dynamic color) */}
        <div className="metric-box">
          <h3>Community Health</h3>
          <p className={`stat ${healthColorClass}`}>{healthScore}/200</p>
        </div>

        {/* (4) New Members (30d) (GREEN) */}
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
