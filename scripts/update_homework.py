#!/usr/bin/env python3
"""
Homework and daily-focus parser — called by Hermes bot / push_homework.sh.
Usage: python3 scripts/update_homework.py "text"  or  python3 scripts/update_homework.py --date YYYY-MM-DD "text"
Reads: data.json (from cwd), DEEPSEEK_API_KEY (from env)
Writes: data.json (to cwd)
"""

import os
import sys
import json
import subprocess
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
WORK_DIR = Path.cwd()

SYSTEM_PROMPT = (
    'You are a TASK RECORDER, NOT a teacher or coach. Your ONLY job is to parse and record.\n'
    'CRITICAL RULES:\n'
    '1. NEVER ask questions, NEVER solve problems, NEVER explain, NEVER add commentary.\n'
    '2. Record task titles EXACTLY as the parent wrote them - even if incomplete or ambiguous.\n'
    '3. If a task says "课本P32第3-5题" with no grade/version, just record it as-is.\n'
    '4. Subject/category names and task titles MUST be in Chinese.\n'
    '5. For school homework, keep the original subject. For adult daily-focus messages,\n'
    '   classify each task as 主线任务、找工作、家庭、娱乐 or 其他.\n'
    '6. estimatedMinutes: dictation 10-15, arithmetic 10-15, workbook 15-20,\n'
    '   reading/reciting 15-20, exam 30-40, essay 25-30, preview 10-15,\n'
    '   crafts 20-30, sports 10-20; adult focus default 45 and may range 15-120.\n'
    'Return ONLY a JSON object. No markdown, no explanation, NOTHING else:\n'
    '{"date":"YYYY-MM-DD","dayOfWeek":"...","subjects":[\n'
    '  {"name":"subject","tasks":[{"title":"task exactly as written","estimatedMinutes":15}]}\n'
    ']}\n'
)


def call_deepseek(text, target_date):
    if not DEEPSEEK_API_KEY:
        print("[ERROR] DEEPSEEK_API_KEY not set")
        return None

    user_message = f"Parse this homework or daily-focus notice:\n\n{text}\n\nTarget date: {target_date}"

    body = json.dumps({
        "model": "deepseek-chat",
        "max_tokens": 2048,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message}
        ]
    })

    tmp = "/tmp/hw_body.json"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(body)

    result = subprocess.run(
        ["curl", "-s", "-m", "60",
         "-H", "Content-Type: application/json",
         "-H", "Authorization: Bearer " + DEEPSEEK_API_KEY,
         "-d", "@" + tmp,
         "https://api.deepseek.com/chat/completions"],
        capture_output=True, text=True, timeout=65
    )

    try:
        os.remove(tmp)
    except:
        pass

    if result.returncode != 0:
        print("[ERROR] curl failed: " + result.stderr[:200])
        return None

    try:
        data = json.loads(result.stdout)
        content = data["choices"][0]["message"]["content"]
        return parse_response(content)
    except (json.JSONDecodeError, KeyError) as e:
        print(f"[ERROR] API response parse failed: {e}")
        print("  " + result.stdout[:200])
        return None


def parse_response(content):
    if not content:
        return None

    s = content.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", s)
    if m:
        s = m.group(1).strip()
    if s.startswith("{") and s.rfind("}") != len(s) - 1:
        s = s[:s.rfind("}") + 1]

    try:
        parsed = json.loads(s)
        if "subjects" not in parsed or not isinstance(parsed["subjects"], list):
            raise ValueError("Missing subjects array")
        for subj in parsed["subjects"]:
            if "tasks" not in subj:
                raise ValueError(f"Subject format: {subj}")
            # AI sometimes returns "subject" instead of "name"
            if "name" not in subj:
                subj["name"] = subj.get("subject", "unknown")
        if "date" not in parsed:
            parsed["date"] = datetime.now().strftime("%Y-%m-%d")
        return parsed
    except (json.JSONDecodeError, ValueError) as e:
        print(f"[ERROR] JSON parse: {e}")
        print(f"  Raw: {s[:300]}")
        return None


def update_data_json(parsed_data):
    data_file = WORK_DIR / "data.json"
    if data_file.exists():
        data = json.loads(data_file.read_text(encoding="utf-8"))
    else:
        data = {"updated": "", "entries": {}}

    date_key = parsed_data["date"]
    if date_key not in data["entries"]:
        data["entries"][date_key] = {"subjects": []}

    existing = data["entries"][date_key]["subjects"]
    for new_subj in parsed_data["subjects"]:
        found = False
        for exist_subj in existing:
            if exist_subj["name"] == new_subj["name"]:
                exist_titles = {t["title"] for t in exist_subj["tasks"]}
                for t in new_subj["tasks"]:
                    if t["title"] not in exist_titles:
                        exist_subj["tasks"].append(t)
                found = True
                break
        if not found:
            existing.append(new_subj)

    tz = timezone(timedelta(hours=8))
    data["updated"] = datetime.now(tz).isoformat()

    data_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[DATA] Updated {date_key} ({len(parsed_data['subjects'])} subjects)")


def main():
    text = ""
    target_date = datetime.now().strftime("%Y-%m-%d")

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--date" and i + 1 < len(args):
            target_date = args[i + 1]
            i += 2
        else:
            text += " " + args[i]
            i += 1

    text = text.strip()
    if not text:
        print("Usage: python3 scripts/update_homework.py [--date YYYY-MM-DD] <homework or daily-focus text>")
        sys.exit(1)

    print(f"[INPUT] {target_date}: {text[:150]}{'...' if len(text) > 150 else ''}")
    print("[AI] Parsing...")

    parsed = call_deepseek(text, target_date)
    if not parsed:
        print("[FAIL] AI parsing failed")
        sys.exit(1)

    print(f"[AI] {len(parsed['subjects'])} subjects, date {parsed.get('date', target_date)}")
    for s in parsed["subjects"]:
        tasks_str = ", ".join(f"{t['title']}({t.get('estimatedMinutes','?')}min)" for t in s["tasks"])
        print(f"  {s['name']}: {tasks_str}")

    update_data_json(parsed)
    print("[OK] data.json written")


if __name__ == "__main__":
    main()
