import { execFileSync } from 'node:child_process';

function getArg(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function getMousePosition() {
  const script = `
import ctypes
from ctypes import util
app = ctypes.cdll.LoadLibrary(util.find_library('ApplicationServices'))
class CGPoint(ctypes.Structure):
    _fields_ = [('x', ctypes.c_double), ('y', ctypes.c_double)]
app.CGEventCreate.restype = ctypes.c_void_p
app.CGEventGetLocation.argtypes = [ctypes.c_void_p]
app.CGEventGetLocation.restype = CGPoint
app.CFRelease.argtypes = [ctypes.c_void_p]
event = app.CGEventCreate(None)
point = app.CGEventGetLocation(event)
app.CFRelease(event)
print(f"{int(point.x)},{int(point.y)}")
`;

  const output = execFileSync('python3', ['-c', script], { encoding: 'utf8' }).trim();
  const [x, y] = output.split(',').map((value) => Number(value));
  return { x, y };
}

async function main() {
  const samples = Math.max(1, Number(getArg('--samples') || '1'));
  const intervalMs = Math.max(100, Number(getArg('--interval-ms') || '1000'));

  for (let index = 0; index < samples; index += 1) {
    const point = getMousePosition();
    console.log(JSON.stringify({ sample: index + 1, ...point }));
    if (index < samples - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
