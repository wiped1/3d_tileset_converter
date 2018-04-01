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

function createTileset()
{
  fs.readFile(process.argv[2], {encoding: 'utf-8'}, (err, data) => {
    if (err) {
      console.log("Error opening file: \n");
      console.log(err);
      process.exit();
    }

    root_meta = JSON.parse(data);

    var tileset = {};
    tileset.asset = {'version': '1.0'};
    tileset.geometricError = 6000;

    tileset.root = {};
    var center = Cesium.Cartesian3.fromDegrees(root_meta.lon, root_meta.lat);
    var transform = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    tileset.root.boundingVolume = {'box': [0,0,0,10,0,0,0,10,0,0,0,10]};
    tileset.root.transform = Cesium.Matrix4.toArray(transform);
    tileset.root.geometricError = 6000;
    tileset.root.refine = 'ADD';
    tileset.root.children = [];

    const isDirectory = source => fs.lstatSync(source).isDirectory();
    var directories = fs.readdirSync(ROOT_DIR).map(name => path.join(ROOT_DIR, name)).filter(isDirectory);

    for (var i = 0; i < directories.length; ++i) {
      var dir = directories[i];
      var dirname = path.dirname(dir);
      var name = path.basename(dir);

      var data = fs.readFileSync(path.join(dir, name + '.meta'), {encoding: 'utf-8'});
      if (data) {
        var child = {};
        child.boundingVolume = {'box': [0,0,0,10,0,0,0,10,0,0,0,10]};
        var meta = JSON.parse(data);
        child.transform = meta.transform;
        child.geometricError = 100;
        child.content = {'url': path.join(name, name + '.b3dm')};

        tileset.root.children.push(child);

      }
    }

    fs.writeFileSync(path.join(ROOT_DIR, 'tileset.json'), JSON.stringify(tileset));
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

  var finder = find(ROOT);
  finder.on('file', function(file, stat) {
    if (path.extname(file) != '.glb') { return; }
    filesToConvert.push(file);
  });

  var script = process.env.TILES_TOOLS_DIR + '3d-tiles-tools.js';
  finder.on('end', function() {
    const numberOfProcesses = filesToConvert.length;
    async.eachOfLimit(filesToConvert, PROCESSES, function(file, index, taskEnd) {
      var args = 'glbToB3dm ' + force + ' -i ' + file
      + ' -o ' + path.join(path.dirname(file), path.basename(file, '.b3dm'));

      console.log("Spawning node process id: " + index + "/" + numberOfProcesses);
      proc = child_process.spawn('node', (script + " " + args).split(" "), {
        encoding: 'utf-8'
      });

      proc.stdout.on('data', (data) => {
        console.log("Process " + index + ": " + data.toString());
      });

      proc.stderr.on('data', (data) => {
        console.log("Process " + index + ": " + data.toString());
      });

      proc.on('close', (code) => {
        console.log("Process " + index + ": ended with code: " + code);
        taskEnd();
      });
    },
    function(err) {
      console.log(err);
    });
  }); 
}

if (TASKS.tileset) {
  createTileset();
}

if (TASKS.convert) {
  convertGlbToB3dm(TASKS.force);
}

