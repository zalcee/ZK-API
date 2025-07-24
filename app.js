const express = require("express");
const axios = require("axios");
const app = express();
const port = 4100;

app.get("/api/n8n/", async (req, res) => {
    try {
        const response = await axios({
            method: "post",
            url: "https://n8n.spruce.ph/webhook-test/test", // 🔴 Replace with actual URL
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify({data:"gdgdhfh"})
        });

        res.json(response.data);
    } catch (error) {
        console.error(error.message);
        res.status(500).send("Request failed");
    }
});

app.listen(port, () => {
    console.log(`Listening to port ${port}`);
});
