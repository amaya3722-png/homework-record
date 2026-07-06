#!/usr/bin/env python3
"""
Hermes Homework Bot - Update data.json from wechat homework messages.
Usage: python update_homework.py "homework text"
"""

import os
import sys
import json
import subprocess
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Config
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO = os.environ.get("GITHUB_REPO", "amaya3722-png/homework-record")
REPO_URL = "https://x-access-token:" + GITHUB_TOKEN + "@github.com/" + GITHUB_REPO if GITHUB_TOKEN else ""
SKIP_GIT_CLONE = os.environ.get("SKIP_GIT_CLONE", "") == "1"
WORK_DIR = Path.cwd() if SKIP_GIT_CLONE else Path(os.environ.get("WORK_DIR", "/tmp/homework-record"))

SYSTEM_PROMPT = (
    "You are a homework assistant for Chinese elementary school students.\n"
    "Extract homework from a parent's message and return JSON.\n"
    "IMPORTANT: Output subject names and task titles in Chinese only.\n"
    "Do NOT translate to English. Preserve original Chinese text.\n"
    "\n"
    "Rules:\n"
    "1. date: infer from text, default to today (YYYY-MM-DD)\n"
    "2. dayOfWeek: compute from date\n"
    "3. Subject names in Chinese only (not English)\n"
    "4. Task titles in Chinese, keep original phrasing\n"
    "5. estimatedMinutes: dictation 10-15, math 10-15, workbook 15-20,\n"
    "   reading 15-20, exam 30-40, essay 25-30, preview 10-15,\n"
    "   crafts 20-30, sports 10-20, default 15\n"
    "\n"
    "Return ONLY JSON, no markdown, no extra text:\n"
    '{"date":"YYYY-MM-DD","dayOfWeek":"...","subjects":[\n'
    '  {"name":"...","tasks":[{"title":"...","estimatedMinutes":15}]}\n'
    ']}\n'
)


def call_deepseek(text, target_date):
    if not DEEPSEEK_API_KEY:
        print("[ERROR] DEEPSEEK_API_KEY not set")
        return None

    import urllib.request
    import urllib.error

    user_message = "Parse this homework notice:\n\n" + text + "\n\nTarget date: " + target_date

    body = json.dumps({
        "model": "deepseek-chat",
        "max_tokens": 2048,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message}
        ]
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.deepseek.com/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + DEEPSEEK_API_KEY
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
            return parse_llm_response(content)
    except urllib.error.HTTPError as e:
        print("[ERROR] DeepSeek HTTP " + str(e.code) + ": " + e.reason)
        body_text = e.read().decode("utf-8", errors="replace")[:200]
        print("  " + body_text)
        return None
    except Exception as e:
        print("[ERROR] " + str(e))
        return None


def parse_llm_response(content):
    if not content:
        return None

    json_str = content.strip()

    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", json_str)
    if match:
        json_str = match.group(1).strip()

    if json_str.startswith("{"):
        last_brace = json_str.rfind("}")
        if last_brace > 0 and last_brace != len(json_str) - 1:
            json_str = json_str[:last_brace + 1]

    try:
        parsed = json.loads(json_str)
        if "subjects" not in parsed or not isinstance(parsed["subjects"], list):
            raise ValueError("Missing subjects array")

        for subj in parsed["subjects"]:
            if "name" not in subj or "tasks" not in subj:
                raise ValueError("Subject format error: " + str(subj))

        if "date" not in parsed:
            parsed["date"] = datetime.now().strftime("%Y-%m-%d")

        return parsed
    except (json.JSONDecodeError, ValueError) as e:
        print("[ERROR] JSON parse failed: " + str(e))
        print("  Raw: " + json_str[:300])
        return None


def update_data_json(parsed_data):
    data_file = WORK_DIR / "data.json"

    if data_file.exists():
        with open(data_file, "r", encoding="utf-8") as f:
            data = json.load(f)
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
                for new_task in new_subj["tasks"]:
                    if new_task["title"] not in exist_titles:
                        exist_subj["tasks"].append(new_task)
                found = True
                break
        if not found:
            existing.append(new_subj)

    tz = timezone(timedelta(hours=8))
    data["updated"] = datetime.now(tz).isoformat()

    with open(data_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("[DATA] Updated " + date_key + " (" + str(len(parsed_data["subjects"])) + " subjects)")


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
        print("Usage: python update_homework.py [--date YYYY-MM-DD] <homework text>")
        sys.exit(1)

    print("[INPUT] Date: " + target_date)
    print("[INPUT] Text: " + text[:200] + ("..." if len(text) > 200 else ""))

    print("[AI] Parsing...")
    parsed = call_deepseek(text, target_date)
    if not parsed:
        print("[FAIL] AI parsing failed")
        sys.exit(1)

    print("[AI] Parsed: " + str(len(parsed["subjects"])) + " subjects, date " + parsed.get("date", target_date))
    for s in parsed["subjects"]:
        tasks_str = ", ".join(t["title"] + " (" + str(t.get("estimatedMinutes", "?")) + "min)" for t in s["tasks"])
        print("  " + s["name"] + ": " + tasks_str)

    update_data_json(parsed)
    print("[SUCCESS] data.json updated")
    if not SKIP_GIT_CLONE:
        print("  https://amaya3722-png.github.io/homework-record/")


if __name__ == "__main__":
    main()
