#!/usr/bin/env python3
"""
Hermes Homework Bot

用法:
    python update_homework.py "语文：背诵《静夜思》 数学：课本P32第3-5题"
    python update_homework.py --date 2026-07-06 "明天的作业：..."

环境变量:
    DEEPSEEK_API_KEY   DeepSeek API Key
    GITHUB_TOKEN       GitHub PAT (standalone mode)
    SKIP_GIT_CLONE     设为 1 则跳过 git clone/push（GitHub Actions 模式）
"""

import os
import sys
import json
import subprocess
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ============ 配置 ============
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO = os.environ.get("GITHUB_REPO", "amaya3722-png/homework-record")
REPO_URL = "https://x-access-token:{}@github.com/{}".format(GITHUB_TOKEN, GITHUB_REPO) if GITHUB_TOKEN else ""
SKIP_GIT_CLONE = os.environ.get("SKIP_GIT_CLONE", "") == "1"
WORK_DIR = Path.cwd() if SKIP_GIT_CLONE else Path(os.environ.get("WORK_DIR", "/tmp/homework-record"))

# ============ AI System Prompt ============
SYSTEM_PROMPT = """You are a homework assistant for elementary school students. Extract homework items from a parent's message and return structured JSON.

Rules:
1. date: Infer the date from the text if mentioned (e.g. "today's homework", "Wednesday"). Default to the provided date.
2. dayOfWeek: Compute from the date (e.g. "Monday", "Tuesday").
3. Supported subjects: Chinese, Math, English, Science, Morality, Art, Music, PE, Labor, IT, Calligraphy, etc.
4. Each subject contains a "tasks" array with "title" and "estimatedMinutes".
5. estimatedMinutes for elementary school students:
   - Handwriting/calligraphy drill: 10-15 min
   - Mental math/arithmetic: 10-15 min
   - Workbook/exercise book: 15-20 min
   - Reading/reciting: 15-20 min
   - Exam paper: 30-40 min
   - Essay/diary: 25-30 min
   - Preview/review: 10-15 min
   - App homework: 10-15 min
   - Crafts/drawing: 20-30 min
   - PE/sports: 10-20 min
   - Unknown type: default 15 min
6. If a task doesn't specify a subject, infer it from the content.
7. Keep titles concise but include key info (page numbers, chapters, names).

Output format (JSON only, no extra text):
{
  "date": "YYYY-MM-DD",
  "dayOfWeek": "Monday",
  "subjects": [
    {
      "name": "Chinese",
      "tasks": [
        {"title": "Recite poem", "estimatedMinutes": 15}
      ]
    }
  ]
}"""


def call_deepseek(text, target_date):
    if not DEEPSEEK_API_KEY:
        print("[ERROR] DEEPSEEK_API_KEY not set")
        return None

    import urllib.request
    import urllib.error

    user_message = "Parse this homework notice:\n\n{}\n\nTarget date: {}".format(text, target_date)

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
        print("[ERROR] DeepSeek API HTTP {}: {}".format(e.code, e.reason))
        body_text = e.read().decode("utf-8")[:200]
        print("  " + body_text)
        return None
    except Exception as e:
        print("[ERROR] {}".format(e))
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

        # Map AI output names back to Chinese
        name_map = {
            "Chinese": "语文", "Math": "数学", "English": "英语",
            "Science": "科学", "Morality": "道法", "Art": "美术",
            "Music": "音乐", "PE": "体育", "Labor": "劳动",
            "IT": "信息", "Calligraphy": "书法",
        }
        for subj in parsed["subjects"]:
            if subj["name"] in name_map:
                subj["name"] = name_map[subj["name"]]

        # Map day names
        day_map = {
            "Monday": "星期一", "Tuesday": "星期二",
            "Wednesday": "星期三", "Thursday": "星期四",
            "Friday": "星期五", "Saturday": "星期六",
            "Sunday": "星期日",
        }
        if parsed.get("dayOfWeek") in day_map:
            parsed["dayOfWeek"] = day_map[parsed["dayOfWeek"]]

        return parsed
    except (json.JSONDecodeError, ValueError) as e:
        print("[ERROR] JSON parse failed: " + str(e))
        print("  Raw: " + json_str[:300])
        return None


def clone_or_pull_repo():
    if not REPO_URL:
        print("[ERROR] GITHUB_TOKEN not set")
        return False

    if WORK_DIR.exists() and (WORK_DIR / ".git").exists():
        print("[GIT] Pulling " + str(WORK_DIR) + "...")
        result = subprocess.run(
            ["git", "-C", str(WORK_DIR), "pull", "origin", "main"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            print("[ERROR] git pull failed: " + result.stderr)
            return False
        print("  " + result.stdout.strip())
    else:
        print("[GIT] Cloning to " + str(WORK_DIR) + "...")
        WORK_DIR.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            ["git", "clone", "--branch", "main", REPO_URL, str(WORK_DIR)],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            print("[ERROR] git clone failed: " + result.stderr)
            return False

    return True


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

    print("[DATA] Updated {} ({}) subjects)".format(date_key, len(parsed_data["subjects"])))


def git_commit_and_push(date_key):
    result = subprocess.run(
        ["git", "-C", str(WORK_DIR), "add", "data.json"],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        print("[ERROR] git add failed: " + result.stderr)
        return False

    result = subprocess.run(
        ["git", "-C", str(WORK_DIR), "commit", "-m", "Update homework for " + date_key],
        capture_output=True, text=True, timeout=10
    )
    if "nothing to commit" in result.stdout or "nothing to commit" in result.stderr:
        print("[GIT] No changes, skipping push")
        return True

    if result.returncode != 0:
        print("[ERROR] git commit failed: " + result.stderr)
        return False

    result = subprocess.run(
        ["git", "-C", str(WORK_DIR), "push", "origin", "main"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        print("[ERROR] git push failed: " + result.stderr)
        return False

    print("[GIT] Pushed to GitHub")
    return True


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

    print("[AI] Parsing homework...")
    parsed = call_deepseek(text, target_date)
    if not parsed:
        print("[FAIL] AI parsing failed")
        sys.exit(1)

    print("[AI] Parsed: {} subjects, date {}".format(len(parsed["subjects"]), parsed.get("date", target_date)))
    for s in parsed["subjects"]:
        tasks_str = ", ".join("{} ({}min)".format(t["title"], t.get("estimatedMinutes", "?")) for t in s["tasks"])
        print("  " + s["name"] + ": " + tasks_str)

    if SKIP_GIT_CLONE:
        update_data_json(parsed)
        print("[SUCCESS] data.json updated, commit/push handled by workflow")
    else:
        if not clone_or_pull_repo():
            sys.exit(1)
        update_data_json(parsed)
        if not git_commit_and_push(parsed.get("date", target_date)):
            sys.exit(1)
        print("[SUCCESS] Homework updated, ~30s until live")
        print("  https://amaya3722-png.github.io/homework-record/")


if __name__ == "__main__":
    main()
