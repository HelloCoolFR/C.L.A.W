// ESM module - runs as child process, reads prompt from argv[2], writes result to stdout
import { pipeline } from '@xenova/transformers';

const prompt = process.argv[2];
if (!prompt) { process.exit(1); }

try {
  const pipe = await pipeline('text2text-generation', 'Xenova/LaMini-Flan-T5-78M');
  const out = await pipe(prompt, { max_new_tokens: 40, temperature: 0.8, repetition_penalty: 1.3 });
  const txt = out[0]?.generated_text ?? '';
  process.stdout.write(txt.trim());
  process.exit(0);
} catch (e) {
  process.stderr.write(String(e));
  process.exit(1);
}
