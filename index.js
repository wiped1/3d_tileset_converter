var fs = require('fs');
var path = require('path');
var Cesium = require('cesium');
var child_process = require('child_process');

// TODO convert script
// ls -d1 */ | sed 's/.$//' | xargs -I % sh -c 'node ~/lib/3d-tiles-tools/tools/bin/3d-tiles-tools.js glbToB3dm -i %/%.glb -o %/%.b3dm'
// convert in blender or separate script?

function printUsage()
{
  console.log(__filename + " [-h --help] root");
  console.log("root: root meta file of your tileset hierarchy");
  console.log("  -h: display this help message");
}

if (process.argv.length < 3)
{
  console.log('Root meta file not specified.\n')
  printUsage();
  process.exit();
}
if (process.argv[2] == '-h' || process.argv[2] == '--help')
{
  printUsage();
  process.exit();
}

const ROOT = path.dirname(process.argv[2]); //'/home/wiped/Downloads/uek2.osm_buildings/'
const ROOT_META_FILE = path.basename(process.argv[2]); //'/home/wiped/Downloads/uek2.osm_buildings/uek2.osm_buildings.meta';

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
  var directories = fs.readdirSync(ROOT).map(name => path.join(ROOT, name)).filter(isDirectory);

  // TODO foreach?
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

      var script = process.env.TILES_TOOLS_DIR + '3d-tiles-tools.js';
      var args = 'glbToB3dm' + ' -f -i ' + path.join(dir, name + '.glb')
          + ' -o ' + path.join(dir, name + '.b3dm');

      console.log("Spawning process: " + "node " + script + " " + args);
      result = child_process.spawnSync('node', (script + " " + args).split(" "), {
        encoding: 'utf-8'
      });

      if (result.signal && result.signal > 0) {
        console.log("Spawned process error with signal " + result.signal + ":\n");
        if (result.stdout) console.log(result.stdout);
        if (result.stderr) console.log(result.stderr);
        if (result.error)  console.log(result.error);
        process.exit();
      }
      else {
        console.log(result.stdout);
        console.log("Progress: " + (i+1) + "/" + directories.length + '\n');
      }
    }
  }

  fs.writeFileSync(path.join(ROOT, 'tileset.json'), JSON.stringify(tileset));
});
