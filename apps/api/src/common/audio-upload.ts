import { HttpStatus } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface.js';
import { z } from 'zod';
import type { AudioInput } from '../ai/ai.types.js';
import { ApiError } from './api-error.js';

// FIL-01: a recording is accepted only when its declared type and its content signature agree.
// It stays in memory (multer's default storage), goes to speech-to-text once and is never
// written to disk or kept (docs/06-yayin-ve-hukuk.md: no audio is stored).

// About 6 minutes of AAC at 64 kbit/s: far more than one answer needs, small enough to bound
// speech-to-text cost per request (RES-01).
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

export const audioUploadOptions: MulterOptions = {
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 4, parts: 6 },
};

type Family = 'mp4' | 'mp3' | 'wav' | 'webm' | 'ogg';

const FAMILY_BY_MIME: Record<string, Family> = {
  'audio/mp4': 'mp4',
  'audio/m4a': 'mp4',
  'audio/x-m4a': 'mp4',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
};

const EXTENSION: Record<Family, { ext: string; mime: string }> = {
  mp4: { ext: 'm4a', mime: 'audio/mp4' },
  mp3: { ext: 'mp3', mime: 'audio/mpeg' },
  wav: { ext: 'wav', mime: 'audio/wav' },
  webm: { ext: 'webm', mime: 'audio/webm' },
  ogg: { ext: 'ogg', mime: 'audio/ogg' },
};

function sniff(data: Buffer): Family | null {
  const ascii = (start: number, end: number) =>
    data.subarray(start, end).toString('latin1');
  if (data.length < 12) {
    return null;
  }
  if (ascii(4, 8) === 'ftyp') return 'mp4';
  if (ascii(0, 3) === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0))
    return 'mp3';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
  if (
    data[0] === 0x1a &&
    data[1] === 0x45 &&
    data[2] === 0xdf &&
    data[3] === 0xa3
  )
    return 'webm';
  if (ascii(0, 4) === 'OggS') return 'ogg';
  return null;
}

export function toAudioInput(file: Express.Multer.File): AudioInput {
  const declared = FAMILY_BY_MIME[file.mimetype.toLowerCase()];
  const detected = sniff(file.buffer);
  if (!declared || !detected || declared !== detected || file.size < 512) {
    throw new ApiError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'invalid_audio',
      'Unsupported or damaged recording',
    );
  }
  // A server-chosen name: nothing from the client's file name is used.
  return {
    data: file.buffer,
    mimeType: EXTENSION[detected].mime,
    filename: `answer.${EXTENSION[detected].ext}`,
  };
}

export const spokenTextSchema = z.strictObject({
  text: z.string().trim().min(1).max(1000).optional(),
});

export type AnswerInput = { audio: AudioInput } | { text: string };

/** Exactly one of a recording or typed text. */
export function answerInput(
  file: Express.Multer.File | undefined,
  text: string | undefined,
): AnswerInput {
  if (file && text) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'one_answer_only',
      'Send either a recording or text, not both',
    );
  }
  if (file) {
    return { audio: toAudioInput(file) };
  }
  if (text) {
    return { text };
  }
  throw new ApiError(
    HttpStatus.BAD_REQUEST,
    'answer_required',
    'Send a recording (field "audio") or text',
  );
}
