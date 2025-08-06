const express = require('express');
const ZKLib = require('node-zklib');
const app = express();
const port = 4300;

const zk = new ZKLib('192.168.1.252', 4370, 10000, 4000); // Update IP if needed

// app.get('/attendance', async (req, res) => {
//   const { start, end } = req.query; // optional query params
//   try {
//     await zk.createSocket();
//     const logs = await zk.getAttendances();
//     await zk.disconnect();

//     const filteredLogs = logs.data.filter(log => {
//       const ts = new Date(log.timestamp);
//       if (start && ts < new Date(start)) return false;
//       if (end && ts > new Date(end)) return false;
//       return true;
//     });

//     res.json(filteredLogs);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

app.get("/attendance", async (req, res) => {
  try {
    await zk.createSocket();

    // Get users and attendance logs
    const users = await zk.getUsers();
    const logs = await zk.getAttendances();

    await zk.disconnect();

    // Create a map from deviceUserId to actual username
    const userMap = {};
    users.data.forEach(user => {
      userMap[user.userId] = user.name || user.userId;
    });

    // Get filter dates from query
    const { start, end } = req.query;
    const startDate = start ? new Date(start) : null;
    const endDate = end ? new Date(end).setHours(23, 59, 59, 999) : null;

    // Filter and enrich logs
    const enrichedLogs = logs.data
      .filter((log) => {
        const logDate = new Date(log.recordTime);
        return (!startDate || logDate >= startDate) &&
               (!endDate || logDate <= endDate);
      })
      .map((log) => {
        const logDate = new Date(log.recordTime);
        return {
          ...log,
          username: userMap[log.deviceUserId] || log.deviceUserId,
          localTime: logDate.toLocaleString("en-PH", { timeZone: "Asia/Manila" }),
        };
      });

    res.json(enrichedLogs);
  } catch (err) {
    console.error("Error getting attendance:", err);
    res.status(500).json({ error: err.message });
  }
});



app.get('/users', async (req, res) => {
  try {
    await zk.createSocket();

    const users = await zk.getUsers();
    await zk.disconnect();

    res.json(users.data); // returns array of users
  } catch (err) {
    console.error('❌ Error getting users:', err.message);
    res.status(500).json({ error: err.message });
  }
});



app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}/attendance`);
});
