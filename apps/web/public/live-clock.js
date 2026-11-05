// A clock for the live script. A browser slows the timers of a tab that is not showing, to once
// a minute after a while; it does not slow a worker's, nor the messages a worker sends. Realtime's
// heartbeat speaks this same small language, so this one file serves both.
let timer = 0;
onmessage = ({ data }) => {
  if (data.event === "start") {
    clearInterval(timer);
    timer = setInterval(() => postMessage({ event: "keepAlive" }), data.interval);
  } else if (data.event === "stop") {
    clearInterval(timer);
  }
};
