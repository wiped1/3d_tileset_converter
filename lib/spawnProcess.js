var childProcess = require('child_process');

function spawnProcessImpl(script, args, callback, spawnFn) {

    // keep track of whether callback has been invoked to prevent multiple invocations
    var invoked = false;

    var process = spawnFn(script, args.split(" "));

    // listen for errors as they may prevent the exit event from firing
    process.on('error', function (err) {
        if (invoked) return;
        invoked = true;
        callback(err);
    });

    // execute the callback once the process has finished running
    process.on('exit', function (code) {
        if (invoked) return;
        invoked = true;
        var err = code === 0 ? null : new Error('exit code ' + code);
        callback(err);
    });

    return process;
}

function spawnProcessSync(script, args, callback) {
  spawnProcessImpl(script, args, callback, function(_script, _args) {
    return childProcess.spawnSync(_script, _args);
  });
}

function spawnProcessAsync(script, args, callback) {
  spawnProcessImpl(script, args, callback, function(_script, _args) {
    return childProcess.spawn(_script, _args);
  });
}

// Usage
// spawnProcess.sync('./some-script.js', 'arg1 arg2', function (err) {
//     if (err) throw err;
//     console.log('finished running some-script.js');
// });
module.exports.sync = spawnProcessSync;
module.exports.async = spawnProcessAsync;
