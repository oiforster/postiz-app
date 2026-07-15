import {
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer } = require('file-type');

const execFileAsync = promisify(execFile);

const ALLOWED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
]);

// Cameras/editores exportam vídeo em containers (ex.: .mov quicktime) e/ou
// codecs de áudio (ex.: PCM) que o allow-list acima (só video/mp4) e o Meta
// Graph API rejeitam. Antes de aplicar o allow-list, remuxamos (sem
// reencodar vídeo) para mp4/aac quando necessário, para que uma postagem
// manual pela interface do Postiz não falhe por causa do formato de origem.
async function probeAudioCodec(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'csv=p=0',
        filePath,
      ],
      { timeout: 60_000 }
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

async function remuxToMp4(filePath: string): Promise<Buffer> {
  const outPath = `${filePath}-remux.mp4`;
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y', '-i', filePath,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-dn',
        '-movflags', '+faststart',
        outPath,
      ],
      { timeout: 5 * 60_000 }
    );
    return readFileSync(outPath);
  } finally {
    try {
      unlinkSync(outPath);
    } catch {
      // no-op: nada a limpar se o ffmpeg não chegou a gerar o arquivo
    }
  }
}

async function ensureMetaCompatibleVideo(
  buffer: Buffer,
  detected: { mime: string; ext: string }
): Promise<Buffer> {
  if (!detected.mime.startsWith('video/')) {
    return buffer;
  }

  const tmpPath = join(tmpdir(), `postiz-upload-${randomUUID()}.${detected.ext}`);
  writeFileSync(tmpPath, buffer);

  try {
    const needsRemux =
      detected.mime !== 'video/mp4' ||
      !['aac', ''].includes(await probeAudioCodec(tmpPath));

    if (!needsRemux) {
      return buffer;
    }

    return await remuxToMp4(tmpPath);
  } catch (err) {
    console.error('Error remuxing video for Meta compatibility:', err);
    return buffer;
  } finally {
    unlinkSync(tmpPath);
  }
}

@Injectable()
export class CustomFileValidationPipe implements PipeTransform {
  async transform(value: any) {
    if (!value || typeof value !== 'object') {
      return value;
    }

    // Skip non-file parameters (org, body, query, etc.)
    if (!('buffer' in value) && !('mimetype' in value) && !('fieldname' in value)) {
      return value;
    }

    if (!value.buffer || !Buffer.isBuffer(value.buffer)) {
      throw new BadRequestException('Invalid file upload.');
    }

    const initialDetection = await fromBuffer(value.buffer);
    const buffer = initialDetection
      ? await ensureMetaCompatibleVideo(value.buffer, initialDetection)
      : value.buffer;

    const detected = await fromBuffer(buffer);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      throw new BadRequestException('Unsupported file type.');
    }

    const maxSize = this.getMaxSize(detected.mime);
    if (buffer.length > maxSize) {
      throw new BadRequestException(
        `File size exceeds the maximum allowed size of ${maxSize} bytes.`
      );
    }

    value.buffer = buffer;
    value.size = buffer.length;
    value.mimetype = detected.mime;
    const safeBase = (value.originalname || 'upload')
      .replace(/\.[^./\\]*$/, '')
      .replace(/[\\/]/g, '_')
      .slice(0, 100) || 'upload';
    value.originalname = `${safeBase}.${detected.ext}`;

    return value;
  }

  private getMaxSize(mimeType: string): number {
    if (mimeType.startsWith('image/')) {
      return 10 * 1024 * 1024; // 10 MB
    } else if (mimeType.startsWith('video/')) {
      return 1024 * 1024 * 1024; // 1 GB
    } else {
      throw new BadRequestException('Unsupported file type.');
    }
  }
}
