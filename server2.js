const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const ZKLib = require('node-zklib');

const app = express();
const port = 4300;

const LOG_FILE = 'upload_log.txt';
const ZK_IP = '192.168.1.252';  // Replace with your actual device IP
const ZK_PORT = 4370;

function appendLog(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}

function toLocalTime(date) {
  return new Date(date).toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
}

function formatDateTime(date, timeStr) {
  return new Date(`${date}T${timeStr}+08:00`);
}

function evaluateAttendance(log) {
  const { date, username, checkIn, checkOut, breakOut, breakIn } = log;

  const remarks = [];

  if (!checkIn || !checkOut || !breakOut || !breakIn) {
    remarks.push('Incomplete attendance');
  } else {
    const checkInTime = formatDateTime(date, checkIn);
    const checkOutTime = formatDateTime(date, checkOut);
    const breakOutTime = formatDateTime(date, breakOut);
    const breakInTime = formatDateTime(date, breakIn);

    const lateLimit = formatDateTime(date, '08:15:00');
    if (checkInTime > lateLimit) {
      remarks.push('Late check-in');
    }

    const minCheckout = formatDateTime(date, '18:30:00');
    if (checkOutTime < minCheckout) {
      remarks.push('Left early');
    }

    const breakDuration = (breakInTime - breakOutTime) / 60000; // in minutes
    if (breakDuration > 60) {
      remarks.push('Late from lunch break');
    }
  }

  if (remarks.length === 0) remarks.push('Present');
  return { ...log, remarks: remarks.join(', ') };
}

async function getAttendanceLogs(startDate, endDate) {
  const zk = new ZKLib(ZK_IP, ZK_PORT, 10000, 4000);
  await zk.createSocket();

  const users = await zk.getUsers();
  const logs = await zk.getAttendances();
  await zk.disconnect();

  const userMap = {};
  users.data.forEach(user => {
    userMap[user.userId] = user.name || user.userId;
  });

  const start = new Date(startDate + 'T00:00:00+08:00');
  const end = new Date(endDate + 'T23:59:59+08:00');

  // Group logs by date and user
  const grouped = {};

  // logs.data.forEach(log => {
  //   const localDate = new Date(log.recordTime);
  //   if (localDate < start || localDate > end) return;

  //   const dateStr = localDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // YYYY-MM-DD
  //   const userId = log.deviceUserId;
  //   const timeStr = localDate.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Manila' }); // HH:mm:ss
  //   const key = `${dateStr}_${userId}`;

  //   if (!grouped[key]) {
  //     grouped[key] = {
  //       date: dateStr,
  //       username: userMap[userId] || userId,
  //       checkIn: null,
  //       checkOut: null,
  //       breakOut: null,
  //       breakIn: null,
  //     };
  //   }

  //   // Smart classification: use time to guess type
  //   const hour = parseInt(timeStr.split(':')[0]);
  //   const record = grouped[key];

  //   if (!record.checkIn || timeStr < record.checkIn) record.checkIn = timeStr;
  //   if (!record.checkOut || timeStr > record.checkOut) record.checkOut = timeStr;

  //   if (hour >= 11 && hour <= 13) {
  //     if (!record.breakOut || timeStr < record.breakOut) record.breakOut = timeStr;
  //     if (!record.breakIn || timeStr > record.breakIn) record.breakIn = timeStr;
  //   }
  // });

  logs.data.forEach(log => {
  const localDate = new Date(log.recordTime);
  if (localDate < start || localDate > end) return;

  const dateStr = localDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // YYYY-MM-DD
  const userId = log.deviceUserId;
  const timeStr = localDate.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Manila' }); // HH:mm:ss
  const hour = parseInt(timeStr.split(':')[0]);

  const key = `${dateStr}_${userId}`;

  if (!grouped[key]) {
    grouped[key] = {
      date: dateStr,
      username: userMap[userId] || userId,
      checkIn: null,
      checkOut: null,
      breakOut: null,
      breakIn: null,
    };
  }

  const record = grouped[key];

  // Assign check-in: earliest before lunch
  if (hour < 11) {
    if (!record.checkIn || timeStr < record.checkIn) record.checkIn = timeStr;
  }

  // Assign break out and break in between 11:00–13:00
  if (hour >= 11 && hour <= 13) {
    if (!record.breakOut || timeStr < record.breakOut) record.breakOut = timeStr;
    if (!record.breakIn || timeStr > record.breakIn) record.breakIn = timeStr;
  }

  // Assign check-out after 15:00
  if (hour >= 15) {
    if (!record.checkOut || timeStr > record.checkOut) record.checkOut = timeStr;
  }
  });

  return Object.values(grouped);
}

async function runAttendanceSync(startDate, endDate, webURL) {
  try {
    const logs = await getAttendanceLogs(startDate, endDate);
    const enrichedLogs = logs.map(evaluateAttendance);

    
    let attempt = 0;
    let success = false;

    while (!success && attempt < 5) {
      attempt++;
      try {
        const res = await axios.post(webURL, enrichedLogs);
        console.log(`✅ Sync successful after ${attempt} attempt(s)`);
        appendLog(`✅ Sync successful after ${attempt} attempt(s)`);
        success = true;
      } catch (err) {
        console.error(`❌ Error in attempt ${attempt}: ${err.message}`);
        appendLog(`❌ Error: ${err.message}`);
        await new Promise(r => setTimeout(r, 60000)); // wait 1 minute
      }
    }
  } catch (err) {
    console.error('❌ Failed to fetch logs:', err.message);
    appendLog(`❌ Failed to fetch logs: ${err.message}`);
  }
}

function getRangeSetA() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startMonth = month === 0 ? 11 : month - 1;
  const startYear = month === 0 ? year - 1 : year;
  const start = new Date(startYear, startMonth, 26);
  const end = new Date(year, month, 10);
  return { start, end };
}

function getRangeSetB() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 11);
  const end = new Date(year, month, 25);
  return { start, end };
}

// CRON: Every minute — alternate range
// cron.schedule('* * 7 * *', async () => {
//     const webURL = 'https://delicate-pipefish-publicly.ngrok-free.app/webhook/attendance?area=HO';
//     const { start, end } = getRangeSetA();
//     await runAttendanceSync(start.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), end.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), webURL);
// });

// cron.schedule('5 * 11 * *', async () => {
//     const webURL = 'https://delicate-pipefish-publicly.ngrok-free.app/webhook/attendance?area=HO';
//     const { start, end } = getRangeSetA();
//     await runAttendanceSync(start.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), end.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), webURL);
// });

// cron.schedule('* * 11 * *', async () => {
//   const webURL = 'https://delicate-pipefish-publicly.ngrok-free.app/webhook/attendance?area=AFF';
//     const { start, end } = getRangeSetA();
//     await runAttendanceSync(start.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), end.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), webURL);
// });

app.post("/attendance", async (req, res) => {
    try {
        const webURL = 'https://delicate-pipefish-publicly.ngrok-free.app/webhook/attendance?area=HO';
        const { start, end } = getRangeSetB();

        const startDate = start.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
        const endDate = end.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

        await runAttendanceSync(startDate, endDate, webURL);

        res.status(200).json({ message: 'Attendance sync started', startDate, endDate });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error running attendance sync', error: error.message });
    }
});

app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}/attendance`);
  appendLog(`Server started`);
});
