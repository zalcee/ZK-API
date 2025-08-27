// server.js
const express = require("express");
const ZKLib = require("node-zklib");
const axios = require("axios");
const app = express();
const port = 4300;

// ⚠️ Set the correct IP of your ZKTeco device
const zk = new ZKLib("192.168.1.252", 4370, 10000, 4000);

// Helper: Manila date key "YYYY-MM-DD" for grouping per local day
const manilaDateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function getManilaDateKey(d) {
  return manilaDateKeyFormatter.format(d); // e.g. "2025-08-01"
}

// Helper: Manila localized display string
function toManilaString(d) {
  return d.toLocaleString("en-PH", { timeZone: "Asia/Manila" });
}

app.get("/attendance", async (req, res) => {
  let connected = false;
  try {
    await zk.createSocket();
    connected = true;

    // Fetch users & logs
    const users = await zk.getUsers();
    const logs = await zk.getAttendances();

    // Build user map (split simple First/Last)
    const userMap = {};
    (users?.data || []).forEach((u) => {
      const parts = (u.name || "").trim().split(/\s+/);
      const firstName = parts[0] || "";
      const lastName = parts.slice(1).join(" ") || "";
      userMap[u.userId] = { firstName, lastName };
    });

    // Parse optional date filters (recommend ISO: YYYY-MM-DD)
    const { start, end } = req.query;
    const startDate = start ? new Date(start) : null;
    const endDate = end ? new Date(end) : null;
    if (endDate) endDate.setHours(23, 59, 59, 999);

    // Pre-filter raw logs by recordTime if start/end were given
    const raw = (logs?.data || []).filter((log) => {
      const dt = new Date(log.recordTime);
      if (Number.isNaN(dt.getTime())) return false;
      if (startDate && dt < startDate) return false;
      if (endDate && dt > endDate) return false;
      return true;
    });

    // Group by (PersonnelID + Manila local date)
    const grouped = new Map();
    for (const log of raw) {
      const dt = new Date(log.recordTime);
      const dateKey = getManilaDateKey(dt); // Manila-local day boundary
      const key = `${log.deviceUserId}__${dateKey}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(log);
    }

    // Build final rows with required headers
    const rows = [];

    for (const [key, punches] of grouped.entries()) {
      // Sort by chronological time
      punches.sort((a, b) => new Date(a.recordTime) - new Date(b.recordTime));

      // Determine statuses strictly by count — ALWAYS first = Check-In
      // Limit to 2–4 logs per day:
      // 1 punch  -> [Check-In]  (remarks: Missing Check-Out)
      // 2 punches-> [Check-In, Check-Out]
      // 3 punches-> [Check-In, Break-Out, Check-Out]
      // 4+       -> [Check-In, Break-Out, Break-In, Check-Out]  (ignore extras)
      let statuses = [];
      if (punches.length === 1) {
        statuses = ["Check-In"];
      } else if (punches.length === 2) {
        statuses = ["Check-In", "Check-Out"];
      } else if (punches.length === 3) {
        statuses = ["Check-In", "Break-Out", "Check-Out"];
      } else if (punches.length >= 4) {
        statuses = ["Check-In", "Break-Out", "Break-In", "Check-Out"];
      }

      // Emit rows (ignore extra punches beyond statuses length)
      punches.forEach((log, idx) => {
        if (idx >= statuses.length) return;

        const dt = new Date(log.recordTime);
        const person = userMap[log.deviceUserId] || { firstName: "", lastName: "" };

        // Remarks: Missing Check-Out if only one punch that day
        const remarks = (punches.length === 1 && idx === 0) ? "Missing Check-Out" : "";

        rows.push({
          "Date and time": toManilaString(dt),
          "Personnel ID": String(log.deviceUserId || ""),
          "First Name": person.firstName,
          "Last Name": person.lastName,
          "Device Name": "ZKTeco Device",   // constant (edit if you want)
          "Event Point": "Main Door",       // adjust to your location
          "Verify Type": log.type || "Fingerprint/Card",
          "In/Out Status": statuses[idx],
          "Event Description": "Attendance Log",
          "Remarks": remarks,
        });
      });
    }
    await axios.post("https://n8n.spruce.ph/webhook-test/getLogs", {rows});
    return res.json(rows);

  } catch (err) {
    console.error("❌ Error getting attendance:", err);
    return res.status(500).json({ error: err?.message || "Unknown error" });
  } finally {
    if (connected) {
      try { await zk.disconnect(); } catch {}
    }
  }
});

app.get("/users", async (req, res) => {
  let connected = false;
  try {-
    await zk.createSocket();
    connected = true;
    const users = await zk.getUsers();
    return res.json(users?.data || []);
  } catch (err) {
    console.error("❌ Error getting users:", err);
    return res.status(500).json({ error: err?.message || "Unknown error" });
  } finally {
    if (connected) {
      try { await zk.disconnect(); } catch {}
    }
  }
});

app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}/attendance`);
});
