const fs = require("fs");

(async () => {
  const url =
    "https://system.gotsport.com/org_event/events/41157/schedules?team=3253347";

  const fetch = (...args) =>
    import("node-fetch").then(({ default: f }) => f(...args));

  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  const t = await r.text();

  fs.writeFileSync("gotsport_debug.html", t, "utf8");

  console.log("status:", r.status);
  console.log("saved bytes:", t.length);
  console.log("has mm/dd/yyyy:", /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t));
  console.log("has vs:", /\svs\.?\s|\sv\s/i.test(t));
  console.log("has table:", /<table/i.test(t));
  console.log("has schedule:", /schedule/i.test(t));
})();
