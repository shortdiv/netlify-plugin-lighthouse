const httpServer = require("http-server");
const puppeteer = require("puppeteer");
const lighthouse = require("lighthouse");
const chromeLauncher = require("chrome-launcher");

const getServer = (url, serveDir) => {
  if (url) {
    // return a mock server for readability
    const server = {
      listen: async (func) => {
        await func();
      },
      close: () => undefined,
    };
    return { server, url };
  }

  if (!serveDir) {
    throw new Error("Empty publish dir");
  }

  console.log(`Serving and scanning site from directory '${serveDir}'`);
  const s = httpServer.createServer({ root: serveDir });
  const port = 5000;
  const host = "localhost";
  const server = {
    listen: (func) => s.listen(port, host, func),
    close: () => s.close(),
  };
  return { url: `http://${host}:${port}`, server };
};

module.exports = {
  name: "netlify-plugin-lighthouse",
  onSuccess: async ({
    constants: { PUBLISH_DIR: serveDir = process.env.PUBLISH_DIR } = {},
    utils,
    inputs: { audit_url: auditUrl = process.env.AUDIT_URL } = {},
  } = {}) => {
    try {
      utils = utils || {
        build: {
          failBuild: (message) => {
            console.error(message);
            process.exit(1);
          },
        },
      };

      const { server, url } = getServer(auditUrl, serveDir);
      const browserFetcher = puppeteer.createBrowserFetcher();
      const revisions = await browserFetcher.localRevisions();
      if (revisions.length <= 0) {
        throw new Error("Could not find local browser");
      }
      const info = await browserFetcher.revisionInfo(revisions[0]);
      
      const { error, results } = await new Promise((resolve) => {
        server.listen(async () => {
          let chrome;
          try {
            chrome = await chromeLauncher.launch({
              chromePath: info.executablePath,
              chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"],
            });
            const results = await lighthouse(url, {
              port: chrome.port,
            });
            if (results.lhr.runtimeError) {
              resolve({ error: new Error(results.lhr.runtimeError.message) });
            }
            resolve({ error: false, results });
          } catch (error) {
            resolve({ error });
          } finally {
            if (chrome) {
              await chrome.kill().catch(() => undefined);
            }
            server.close()
          }
        });
      });
      if (error) {
        throw error;
      } else {
        console.log(results);
      }
    } catch (error) {
      console.error(`\nError: ${error.message}\n`);
      utils.build.failBuild(`failed with error: ${error.message}`);
    }
  },
};
