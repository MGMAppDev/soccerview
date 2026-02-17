// Simple test to parse Demosphere JSON
const fetch = require("node-fetch");

(async () => {
  const url = "https://elements.demosphere-secure.com/80738/schedules/Fall2025/115189283.js";
  
  const response = await fetch(url);
  const jsonText = await response.text();
  const jsonData = JSON.parse(jsonText);
  
  console.log("Match count:", Object.keys(jsonData).length);
  console.log("\nFirst match:");
  const firstKey = Object.keys(jsonData)[0];
  console.log(JSON.stringify(jsonData[firstKey], null, 2));
  
  // Parse a match
  const match = jsonData[firstKey];
  console.log("\nParsed:");
  console.log("Date:", match.dt);
  console.log("Time:", match.tim);
  console.log("Team 1 ID:", match.tm1);
  console.log("Team 2 ID:", match.tm2);
  console.log("Score 1:", match.sc1);
  console.log("Score 2:", match.sc2);
  console.log("Location:", match.facn);
})();
