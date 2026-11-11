(() => {
  const channel = new MessageChannel();
  globalThis.chorusPagePort = channel.port1;
  window.postMessage({ __chorusBridge: 1 }, location.origin, [channel.port2]);
})();
