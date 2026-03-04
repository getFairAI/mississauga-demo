# summarize_call.py
import os
import ollama
import sys
from pathlib import Path
from openai import OpenAI


USE_OPEN_SOURCE = os.getenv("USE_OPEN_SOURCE_AI", "false").lower() == "true"

api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise RuntimeError(
        "OPENAI_API_KEY não está definido nas variáveis de ambiente.\n"
        "Adiciona ao teu .env, por exemplo:\n"
        'OPENAI_API_KEY="sk-..."'
    )

client = OpenAI(api_key=api_key)


def generate_summary(transcript_text: str) -> str:
    """
    Gera um resumo completo e detalhado a partir de uma transcrição de chamada.
    """
    system_msg = (
    "You are an assistant specialized in analyzing and summarizing call transcripts.\n"
    "Your goal is to produce an extremely clear, structured, and comprehensive summary,\n"
    "preserving ALL relevant information.\n\n"
    "The summary must include:\n"
    "- Participants (if mentioned)\n"
    "- Main topics discussed\n"
    "- Decisions made\n"
    "- Action items / next steps\n"
    "- Dates, amounts, numbers, and any important details\n"
    "- Problems raised and proposed solutions\n"
    "- Any commitments or agreements made during the call\n\n"
    "Do NOT invent information. Everything must come strictly from the transcript.\n"
    "Write the summary in clear, professional, international business English, "
    "regardless of the language used in the transcript."
    )

    user_msg = (
        "Below is the full transcript of a call.\n"
        "Produce a highly complete and detailed summary.\n\n"
        "Transcript:\n"
        f"{transcript_text}"
    )

    
    if USE_OPEN_SOURCE:
        # ---------- OLLAMA ----------
        prompt = f"{system_msg}\n\n{user_msg}"
        response = ollama.generate(
            model="qwen2.5:32b",
            prompt=prompt.strip(),
        )
        return response["response"].strip()

    else:
        # ---------- OPENAI ----------
        response = client.chat.completions.create(
            model="gpt-4.1",
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.2,
        )
        return response.choices[0].message.content.strip()


def main():
    if len(sys.argv) < 2:
        print("Uso: python summarize_call.py caminho_para_transcript.txt")
        sys.exit(1)

    transcript_path = Path(sys.argv[1]).resolve()
    if not transcript_path.exists():
        print(f"Ficheiro não encontrado: {transcript_path}")
        sys.exit(1)

    transcript_text = transcript_path.read_text(encoding="utf-8")

    print(f"[INFO] A gerar resumo para: {transcript_path}")
    resumo = generate_summary(transcript_text)

    summary_path = transcript_path.with_name(f"{transcript_path.stem}_summary.txt")
    summary_path.write_text(resumo, encoding="utf-8")

    print(f"[OK] Ficheiro criado: {summary_path}")


if __name__ == "__main__":
    main()
