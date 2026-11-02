"""The simulated patient: a cheap Claude model plays the patient from the case's goal card."""

import anthropic

PATIENT_MODEL = "claude-haiku-5-5"
END = "[END]"

SYSTEM = """\
You are role-playing a patient who is messaging a dermatology clinic on WhatsApp, to test the clinic's booking \
assistant. Stay in character the whole time.

Your goal and situation:
{goal}

How to write
- Write the next message only: short, casual WhatsApp style, the way a real patient in Amman would text.
- Use the same language and dialect as your first message (Jordanian Arabic, or English if your first message was \
English). Never switch language unless your goal says so.
- Answer what the clinic asks, using the details in your goal. If it asks for something your goal does not cover, \
give a plausible short answer that does not change your goal.
- Follow the instructions in your goal exactly, including when to change your mind and when to say yes. When you \
confirm, use a plain yes such as "نعم" or "yes".
- Never mention that this is a test or that you are an AI.
- When your goal is complete, or the clinic says the team will contact you, or there is nothing left to say, reply \
with exactly [END] and nothing else.
"""


def next_message(client: anthropic.Anthropic, goal: str, transcript: list[tuple[str, str]], usage: list) -> str:
    """The patient's next message given the chat so far [(speaker, text)], or END."""
    lines = []
    for speaker, text in transcript:
        lines.append(f"{'You' if speaker == 'patient' else 'Clinic'}: {text}")
    prompt = ("The chat so far:\n\n" + "\n\n".join(lines) +
              f"\n\nWrite your next message to the clinic, or {END} if you are done.")
    response = client.messages.create(
        model=PATIENT_MODEL,
        max_tokens=2000,
        system=SYSTEM.format(goal=goal),
        output_config={"effort": "low"},
        messages=[{"role": "user", "content": prompt}],
    )
    usage.append(response.usage.model_dump())
    if response.stop_reason == "refusal":
        raise RuntimeError("patient simulator refused")
    text = "\n".join(b.text for b in response.content if b.type == "text").strip()
    return END if not text or text.startswith(END) else text
