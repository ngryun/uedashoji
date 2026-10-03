// 기존 원본 영상은 보존하고, 긴 변 960px·최대 30fps의 모바일용 MP4를 생성한다.
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = resolve(root, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const videos = manifest.items.filter(item => item.type === 'video');
const files = [...new Set([...videos.map(item => item.file.split('?')[0]), 'assets/videos/secret/secret.mp4'])];
const run = (command, args) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => errors = (errors + chunk).slice(-4000));
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolveRun(output) : reject(new Error(errors)));
});
const versions = new Map();
for (const file of files) {
  const source = resolve(root, file);
  const info = await stat(source);
  const version = `960-30-crf27-v1|${info.size}|${Math.trunc(info.mtimeMs)}`;
  const mobile = file.replace(/\.mp4$/, '.mobile.mp4');
  const destination = resolve(root, mobile);
  const metadata = resolve(root, 'assets/.source-map/mobile', `${file.replaceAll('/', '_')}.txt`);
  let ready = false;
  try { ready = (await readFile(metadata, 'utf8')) === version && (await stat(destination)).size > 0; } catch {}
  if (!ready) {
    const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=avg_frame_rate', '-of', 'json', source]));
    const [n, d] = probe.streams[0].avg_frame_rate.split('/').map(Number);
    const fps = n / d > 30 ? ',fps=30' : '';
    const temporary = destination.replace(/\.mp4$/, '.tmp.mp4');
    await run('ffmpeg', ['-nostdin', '-y', '-v', 'error', '-i', source,
      '-vf', `scale=w='if(gte(iw,ih),min(960,iw),-2)':h='if(gte(iw,ih),-2,min(960,ih))'${fps}`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '27', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '80k', '-movflags', '+faststart', '-map_metadata', '-1', temporary]);
    await rename(temporary, destination);
    await mkdir(dirname(metadata), { recursive: true });
    await writeFile(metadata, version);
  }
  versions.set(file, `${mobile}?v=${info.size}-${Math.trunc(info.mtimeMs)}-m1`);
  console.log(`${ready ? 'cached' : 'created'} ${mobile}`);
}
for (const item of videos) item.mobileFile = versions.get(item.file.split('?')[0]);
await writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest) + '\n');
await rename(`${manifestPath}.tmp`, manifestPath);
console.log(`Mobile variants ready: ${files.length}`);
