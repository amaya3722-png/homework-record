#!/usr/bin/env python3
"""
Hermes Homework Bot — 企微群收到作业消息后自动更新 data.json

用法:
    python update_homework.py "语文：背诵《静夜思》 数学：课本P32第3-5题"
    python update_homework.py --date 2026-07-06 "明天作业：..."

环境变量:
    DEEPSEEK_API_KEY — DeepSeek API Key
    GITHUB_TOKEN      — GitHub Personal Access Token (repo scope)
    GITHUB_REPO       — 仓库名 (默认: amaya3722-png/homework-record)
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
REPO_URL = f"https://{GITHUB_TOKEN}@github.com/{GITHUB_REPO}.git" if GITHUB_TOKEN else ""

# GitHub Actions 中 repo 已 checkout，SKIP_GIT_CLONE=1 直接用当前目录
SKIP_GIT_CLONE = os.environ.get("SKIP_GIT_CLONE", "") == "1"
WORK_DIR = Path.cwd() if SKIP_GIT_CLONE else Path(os.environ.get("WORK_DIR", "/tmp/homework-record"))

# ============ AI Prompt ============
SYSTEM_PROMPT = """你是一个小学作业整理助手。用户会提供一段文字（通常是老师发的作业通知），请从中提取作业信息并返回严格的JSON格式。

规则：
1. 日期：如果文字中提到了日期（如"今天的作业"、"周三作业"、"6月15日"），请推断出具体日期。如果没有明确提到日期，使用用户提供的今天日期。
2. dayOfWeek：根据日期计算是星期几（如"星期一"、"星期二"）
3. 支持的学科包括但不限于：语文、数学、英语、科学、道法（道德与法治）、美术、音乐、体育、劳动、信息（信息技术）、书法、综合实践
4. 每个学科下的tasks数组，每个task有title和estimatedMinutes
5. estimatedMinutes根据作业内容和难度合理推断，按照小学生标准：
   - 练字/写字/生字：10-15分钟
   - 口算/计算/算术：10-15分钟
   - 练习册/同步练习/一课一练：15-20分钟
   - 阅读/朗读/背诵：15-20分钟
   - 试卷/测试卷/单元卷：30-40分钟
   - 作文/日记/写话：25-30分钟
   - 预习/复习：10-15分钟
   - APP作业/打卡：10-15分钟
   - 手工/画画：20-30分钟
   - 体育/跳绳/跑步/运动：10-20分钟
   - 其他未明确类型：默认15分钟
6. 如果文字中某条作业没有明确指定学科，根据内容合理推断
7. 每项作业的title应该简洁明确，保留关键信息（如页码、章节、名称）

返回格式（仅返回JSON，不要额外说明文字）：
{
  "date": "YYYY-MM-DD",
  "dayOfWeek": "星期X",
  "subjects": [
    {
      "name": "学科名称",
      "tasks": [
        {"title": "具体作业内容", "estimatedMinutes": 15}
      ]
    }
  ]
}"""


def call_deepseek(text: str, target_date: str) -> dict | None:
    """调用 DeepSeek API 解析作业文本"""
    if not DEEPSEEK_API_KEY:
        print("[ERROR] DEEPSEEK_API_KEY 未设置")
        return None

    import urllib.request
    import urllib.error

    user_message = f"请整理以下作业通知：\n\n{text}\n\n今天的日期是：{target_date}"

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
            "Authorization": f"Bearer {DEEPSEEK_API_KEY}"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
            return parse_llm_response(content)
    except urllib.error.HTTPError as e:
        print(f"[ERROR] DeepSeek API 请求失败: {e.code} {e.reason}")
        body = e.read().decode("utf-8")[:200]
        print(f"  {body}")
        return None
    except Exception as e:
        print(f"[ERROR] {e}")
        return None


def parse_llm_response(content: str) -> dict | None:
    """解析 LLM 返回的 JSON"""
    if not content:
        return None

    json_str = content.strip()

    # 提取 markdown 代码块中的 JSON
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", json_str)
    if match:
        json_str = match.group(1).strip()

    # 尝试找到完整 JSON 对象
    if json_str.startswith("{"):
        last_brace = json_str.rfind("}")
        if last_brace > 0 and last_brace != len(json_str) - 1:
            json_str = json_str[:last_brace + 1]

    try:
        parsed = json.loads(json_str)
        if "subjects" not in parsed or not isinstance(parsed["subjects"], list):
            raise ValueError("缺少 subjects 数组")

        for subj in parsed["subjects"]:
            if "name" not in subj or "tasks" not in subj:
                raise ValueError(f"学科格式不正确: {subj}")

        if "date" not in parsed:
            parsed["date"] = datetime.now().strftime("%Y-%m-%d")

        return parsed
    except (json.JSONDecodeError, ValueError) as e:
        print(f"[ERROR] JSON 解析失败: {e}")
        print(f"  原始内容: {json_str[:300]}")
        return None


def clone_or_pull_repo():
    """Clone 或 pull GitHub 仓库"""
    if not REPO_URL:
        print("[ERROR] GITHUB_TOKEN 未设置，无法操作仓库")
        return False

    if WORK_DIR.exists() and (WORK_DIR / ".git").exists():
        print(f"[GIT] Pulling {WORK_DIR}...")
        result = subprocess.run(
            ["git", "-C", str(WORK_DIR), "pull", "origin", "main"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            print(f"[ERROR] git pull 失败: {result.stderr}")
            return False
        print(f"  {result.stdout.strip()}")
    else:
        print(f"[GIT] Cloning to {WORK_DIR}...")
        WORK_DIR.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            ["git", "clone", "--branch", "main", REPO_URL, str(WORK_DIR)],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            print(f"[ERROR] git clone 失败: {result.stderr}")
            return False

    return True


def update_data_json(parsed_data: dict):
    """更新 data.json，追加新作业条目"""
    data_file = WORK_DIR / "data.json"

    # 读现有数据
    if data_file.exists():
        with open(data_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = {"updated": "", "entries": {}}

    date_key = parsed_data["date"]

    # 检查是否已存在同日期条目
    if date_key not in data["entries"]:
        data["entries"][date_key] = {"subjects": []}

    existing = data["entries"][date_key]["subjects"]

    # 合并：同日期 + 同学科 → 追加 tasks
    for new_subj in parsed_data["subjects"]:
        found = False
        for exist_subj in existing:
            if exist_subj["name"] == new_subj["name"]:
                # 合并 tasks，去重
                exist_titles = {t["title"] for t in exist_subj["tasks"]}
                for new_task in new_subj["tasks"]:
                    if new_task["title"] not in exist_titles:
                        exist_subj["tasks"].append(new_task)
                found = True
                break
        if not found:
            existing.append(new_subj)

    # 更新时间戳
    tz = timezone(timedelta(hours=8))
    data["updated"] = datetime.now(tz).isoformat()

    with open(data_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"[DATA] 已更新 {date_key}，共 {len(parsed_data['subjects'])} 个学科")


def git_commit_and_push(date_key: str):
    """提交并推送 data.json"""
    result = subprocess.run(
        ["git", "-C", str(WORK_DIR), "add", "data.json"],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        print(f"[ERROR] git add 失败: {result.stderr}")
        return False

    result = subprocess.run(
        ["git", "-C", str(WORK_DIR), "commit", "-m", f"Update homework for {date_key}"],
        capture_output=True, text=True, timeout=10
    )
    # commit 返回非 0 可能是 "nothing to commit"，这不算错误
    if "nothing to commit" in result.stdout or "nothing to commit" in result.stderr:
        print("[GIT] 没有新变更，跳过 push")
        return True

    if result.returncode != 0:
        print(f"[ERROR] git commit 失败: {result.stderr}")
        return False

    result = subprocess.run(
        ["git", "-C", str(WORK_DIR), "push", "origin", "main"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        print(f"[ERROR] git push 失败: {result.stderr}")
        return False

    print(f"[GIT] 已推送到 GitHub ✓")
    return True


def main():
    text = ""
    target_date = datetime.now().strftime("%Y-%m-%d")

    # 解析参数
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
        print("用法: python update_homework.py [--date YYYY-MM-DD] \"作业文字...\"")
        print("示例: python update_homework.py \"语文：背诵课文 数学：P32第3题\"")
        print("      python update_homework.py --date 2026-07-06 \"明天的作业：...\"")
        sys.exit(1)

    print(f"[INPUT] 日期: {target_date}")
    print(f"[INPUT] 文本: {text[:200]}{'...' if len(text) > 200 else ''}")

    # Step 1: 调 AI 解析
    print("[AI] 正在解析作业...")
    parsed = call_deepseek(text, target_date)
    if not parsed:
        print("[FAIL] AI 解析失败")
        sys.exit(1)

    print(f"[AI] 解析成功：{len(parsed['subjects'])} 个学科，日期 {parsed.get('date', target_date)}")
    for s in parsed["subjects"]:
        tasks_str = ", ".join(f"{t['title']}({t.get('estimatedMinutes', '?')}min)" for t in s["tasks"])
        print(f"  {s['name']}: {tasks_str}")

    if SKIP_GIT_CLONE:
        # GitHub Actions: repo 已 checkout，直接改 + 提交
        update_data_json(parsed)
        print("[SUCCESS] data.json 已更新，commit/push 由 workflow 接管")
    else:
        # 独立运行模式：自己 clone + push
        if not clone_or_pull_repo():
            sys.exit(1)
        update_data_json(parsed)
        if not git_commit_and_push(parsed.get("date", target_date)):
            sys.exit(1)
        print("[SUCCESS] 作业已更新，约 30 秒后线上生效")
        print(f"  https://amaya3722-png.github.io/homework-record/")


if __name__ == "__main__":
    main()
