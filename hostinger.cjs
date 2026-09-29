// Hostinger's LiteSpeed launcher loads the application entrypoint with
// CommonJS require(). Keep this small bridge in CommonJS and load the actual
// ES module dynamically so server/index.js can continue using top-level await.
import("./server/index.js").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
