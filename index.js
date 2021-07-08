const DefaultReporter = require('./lib/default_reporter'),
  webdriverModule = require('./lib/webdriver'),
  Server = require('./lib/server'),
  Runner = require('./lib/runner'),
  ModuleLoader = require('./lib/moduleLoader');

async function createReporters(options) {
  if (!options.reporters) {
    return [new DefaultReporter(options)];
  }

  const result = [];
  const loader = new ModuleLoader();

  for (const reporterOrModuleName of options.reporters) {
    if (typeof reporterOrModuleName === 'object') {
      result.push(reporterOrModuleName);
    } else {
      try {
        // TODO: Where should relative imports be relative to?
        // For now, they'll be relative to this module like they were before,
        // but that's probably not what anyone actually using relative imports
        // wants.
        const fullPath = require.resolve(reporterOrModuleName);
        const Reporter = await loader.load(fullPath);
        result.push(new Reporter());
      } catch (e) {
        throw new Error(
          `Failed to register reporter ${reporterOrModuleName}: ${e.message}`
        );
      }
    }
  }

  return result;
}

/**
 * @module jasmine-browser-runner
 */
module.exports = {
  /**
   * Starts a {@link Server} that will serve the specs and supporting files via HTTP.
   * @param {ServerCtorOptions} options to use to construct the server
   * @param {ServerStartOptions} serverOptions Options to use to start the server
   * @return {Promise<undefined>} A promise that is resolved when the server is
   * started.
   */
  startServer: function(options, serverOptions) {
    const server = new Server(options);
    return server.start(serverOptions || {});
  },
  /**
   * Runs the specs.
   * @param {RunSpecsOptions} options
   * @return {Promise<JasmineDoneInfo>} A promise that resolves to the {@link https://jasmine.github.io/api/edge/global.html#JasmineDoneInfo|overall result} when the suite has finished running.
   */
  runSpecs: async function(options, deps) {
    options = options || {};
    if (options.browser && options.browser.name === 'internet explorer') {
      options.jsonDomReporter = true;
    } else {
      options.batchReporter = true;
    }

    deps = deps || {};
    const ServerClass = deps.Server || Server;
    const RunnerClass = deps.Runner || Runner;
    const buildWebdriver =
      deps.buildWebdriver || webdriverModule.buildWebdriver;
    const setExitCode = deps.setExitCode || (code => (process.exitCode = code));
    const server = new ServerClass(options);
    const webdriver = buildWebdriver(options.browser);

    const reporters = await createReporters(options);
    const useSauce = options.browser && options.browser.useSauce;
    const portRequest = useSauce ? 5555 : 0;
    await server.start({ port: portRequest });
    const host = `http://localhost:${server.port()}`;
    const runner = new RunnerClass({ webdriver, reporters, host });

    console.log('Running tests in the browser...');

    try {
      const details = await runner.run(options);

      if (details.overallStatus === 'passed') {
        setExitCode(0);
      } else if (details.overallStatus === 'incomplete') {
        setExitCode(2);
      } else {
        setExitCode(1);
      }

      return details;
    } finally {
      await server.stop();

      if (useSauce) {
        await webdriver.executeScript(
          `sauce:job-result=${process.exitCode === 0}`
        );
      }

      await webdriver.close();
    }
  },
  Server,
  Runner,
  DefaultReporter,
};
