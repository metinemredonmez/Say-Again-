import { answerInput, toAudioInput } from './audio-upload.js';

function file(data: Buffer, mimetype: string): Express.Multer.File {
  return {
    buffer: data,
    mimetype,
    size: data.length,
    originalname: '../../etc/passwd',
  } as Express.Multer.File;
}

const m4a = () => {
  const data = Buffer.alloc(1024);
  data.write('ftypM4A ', 4, 'latin1');
  return data;
};
const wav = () => {
  const data = Buffer.alloc(1024);
  data.write('RIFF', 0, 'latin1');
  data.write('WAVE', 8, 'latin1');
  return data;
};

describe('audio upload checks (FIL-01)', () => {
  it('accepts a recording whose type and signature agree, with a server-chosen name', () => {
    expect(toAudioInput(file(m4a(), 'audio/x-m4a'))).toMatchObject({
      mimeType: 'audio/mp4',
      filename: 'answer.m4a',
    });
    expect(toAudioInput(file(wav(), 'audio/wav'))).toMatchObject({
      mimeType: 'audio/wav',
      filename: 'answer.wav',
    });
  });

  it('rejects a declared type that does not match the content', () => {
    expect(() => toAudioInput(file(wav(), 'audio/mp4'))).toThrow(
      /Unsupported or damaged/,
    );
    expect(() =>
      toAudioInput(file(Buffer.alloc(1024, 0x41), 'audio/mp4')),
    ).toThrow();
    expect(() =>
      toAudioInput(file(m4a(), 'application/octet-stream')),
    ).toThrow();
  });

  it('rejects files too small to hold speech', () => {
    expect(() =>
      toAudioInput(file(m4a().subarray(0, 100), 'audio/mp4')),
    ).toThrow();
  });

  it('takes exactly one of a recording or text', () => {
    expect(answerInput(undefined, 'Hello')).toEqual({ text: 'Hello' });
    expect(() => answerInput(undefined, undefined)).toThrow(/recording/);
    expect(() => answerInput(file(m4a(), 'audio/mp4'), 'Hello')).toThrow(
      /not both/,
    );
  });
});
