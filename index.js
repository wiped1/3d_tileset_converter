var fs = require('fs');
var path = require('path');
var Cesium = require('cesium');
var child_process = require('child_process');
var find = require('findit');
var async = require('async');

function printUsage()
{
  console.log(__filename + " root [tasks...] [--proc -p num] [--help -h]");
  console.log("root: root meta file of your tileset hierarchy");
  console.log("tasks: space separated list of tasks to run");
  console.log("       can be equal to: 'convert' 'force' 'tileset'");
  console.log("--proc -p: number of async processed created for 'convert' task");
  console.log("           defaults to 1");
  console.log("--help -h: display help message");
}

if (process.argv.length < 3)
{
  console.log('Root meta file not specified.\n')
  printUsage();
  process.exit();
}
if (process.argv.find((element) => { 
  return element == '-h' || element == '--help'; 
}))
{
  printUsage();
  process.exit();
}

var TASKS = {
  tileset: process.argv.includes('tileset'),
  convert: process.argv.includes('convert'),
  force: process.argv.includes('force')
};

var PROCESSES = 1;
var index = process.argv.findIndex((element) => {
  return element == '--proc' || element == '-p';
});
if (index > 0) { PROCESSES = process.argv[index + 1]; }

const ROOT = process.argv[2];
const ROOT_DIR = path.dirname(process.argv[2]);
const ROOT_META_FILE = path.basename(process.argv[2]);

function defaultBounds() {
  return {
    x: {min: 0, max: 1},
    y: {min: 0, max: 1},
    z: {min: 0, max: 1}
  };
}

function boundsMinMax(current, boundsMeta) {
  if (boundsMeta === undefined)
    return;

  newMinMax = (oldPlane, newPlane) => {
    if (oldPlane.min > newPlane.min)
      oldPlane.min = newPlane.min;
    if (oldPlane.max < newPlane.max)
      oldPlane.max = newPlane.max;
  }

  newMinMax(current.x, boundsMeta.x)
  newMinMax(current.y, boundsMeta.y)
  newMinMax(current.z, boundsMeta.z)
}

function getBoundingVolume(bounds) {
  /*
    `box` bounding volume is an array of 12 numbers
    First three elements define x, y, z position.
    Next three elements define x-axis position, and half-length of the box in x-direction
    Same goes for next 3 elements, that describe y-axis position, and half length of the box in y-direction
    Last 3 elements are the same, but for z-axis.
  */
  if (bounds === undefined)
    bounds = defaultBounds()

  var position = [0, 0, 0];

  getHalfLength = plane => (plane.max - plane.min) / 2;

  xHalfLength = Math.max(1, getHalfLength(bounds.x));
  yHalfLength = Math.max(1, getHalfLength(bounds.y));
  zHalfLength = Math.max(1, getHalfLength(bounds.z));

  var xAxis = [xHalfLength, 0          , 0          ];
  var yAxis = [0          , yHalfLength, 0          ];
  var zAxis = [0          , 0          , zHalfLength];

  // adjust z position based on height
  position[2] = zHalfLength;

  return [].concat(position, xAxis, yAxis, zAxis)
}

function createTileset() {
  console.log("Reading file " + process.argv[2]);
  fs.readFile(process.argv[2], {encoding: 'utf-8'}, (err, data) => {
    if (err) {
      console.log("Error opening file: \n");
      console.log(err);
      process.exit();
    }

    root_meta = JSON.parse(data);

    var tileset = {};
    tileset.asset = {'version': '1.0'};
    tileset.geometricError = root_meta.geometricError;

    tileset.root = {};
    var center = Cesium.Cartesian3.fromDegrees(root_meta.lon, root_meta.lat);
    var transform = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    tileset.root.transform = Cesium.Matrix4.toArray(transform);
    tileset.root.geometricError = root_meta.geometricError;
    tileset.root.refine = 'ADD';
    tileset.root.children = [];

    var childrenBounds = defaultBounds()

    var finder = find(ROOT_DIR);
    finder.on('file', function(file, stat) {
      if (path.extname(file) != '.meta') { return; }
      var data = fs.readFileSync(file, {encoding: 'utf-8'});
      if (data) {
        var child = {};
        var meta = JSON.parse(data);
        child.transform = meta.transform;
        child.boundingVolume = {'box': getBoundingVolume(meta.bounds) }

        boundsMinMax(childrenBounds, meta.bounds);

        var relative = path.relative(ROOT_DIR, file);
        var childPath = path.join(path.join(path.dirname(relative), path.basename(relative, '.meta')));
        child.content = {'url': childPath + '.b3dm'};

        tileset.root.children.push(child);
      }
    });

    finder.on('end', function() {
      tileset.root.boundingVolume = {'box': getBoundingVolume(childrenBounds)};

      fs.writeFileSync(path.join(ROOT_DIR, 'tileset.json'), JSON.stringify(tileset));
    });
  });
}

function convertGlbToB3dm(force) {
  if (force) { force = ' -f'; }
  else { force = ''; }

  if (process.env.TILES_TOOLS_DIR === undefined) {
    console.log("TILES_TOOLS_DIR env variable undefined."); 
    console.log("Please set location of '3d-tiles-tools' script.");
    return;
  }

  var filesToConvert = [];

  console.log('Scanning ' + ROOT_DIR);
  var finder = find(ROOT_DIR);
  finder.on('file', function(file, stat) {
    if (path.extname(file) != '.glb') { return; }
    filesToConvert.push(file);
  });

  var script = process.env.TILES_TOOLS_DIR + '3d-tiles-tools.js';
  finder.on('end', function() {
    console.log('Running convert on ' + filesToConvert.length + ' files');
    const numberOfProcesses = filesToConvert.length;
    async.eachOfLimit(filesToConvert, PROCESSES, function(file, index, taskEnd) {
      var output = path.join(path.dirname(file), path.basename(file, '.glb')) + '.b3dm';
      var args = 'glbToB3dm ' + force + ' -i ' + file + ' -o ' + output;

      console.log("Spawning conversion process id: " + index + "/" + numberOfProcesses);
      // TODO add verbose flag
      console.log("  file: " + file);
      console.log("  output: " + output);
      proc = child_process.spawn('node', (script + " " + args).split(" "), {
        encoding: 'utf-8'
      });

      proc.stdout.on('data', (data) => {
        console.log("Conversion process " + index + ": " + data.toString());
      });

      proc.stderr.on('data', (data) => {
        console.log("Conversion process " + index + ": " + data.toString());
      });

      proc.on('close', (code) => {
        console.log("Conversion process " + index + ": ended with code: " + code);
        taskEnd();
      });
    },
    function(err) {
      if (err) {
        console.log(err);
      }
    });
  }); 
}

if (TASKS.tileset) {
  console.log("Running `tileset` task");
  createTileset();
}

if (TASKS.convert) {
  console.log("Running `convert` task, with `force` set to " + TASKS.force);
  convertGlbToB3dm(TASKS.force);
}

