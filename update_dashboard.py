"""
Sunquell Mission Control â Nightly Dashboard Updater
Runs via GitHub Actions. Pulls fresh data from Zoho CRM and updates index.html.
Required env vars: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
"""
import os, re, json, requests
from datetime import date, datetime

ZOHO_TOKEN_URL = "https://accounts.zohocloud.ca/oauth/v2/token"
ZOHO_COQL_URL  = "https://www.zohoapis.com/crm/v2/coql"

OWNER_MAP = {"Mueller": "Daniel Mueller", "Parsons": "Madison Parsons"}

STAGE_ACTION = {
    "Quote Sent":       "ð Follow up",
    "Booked":           "ð Confirm install",
    "Stalling":         "â ï¸ Recovery email",
    "Tentative Booking":"ð Confirm",
}


def get_token():
    r = requests.post(ZOHO_TOKEN_URL, data={
        "grant_type":    "refresh_token",
        "client_id":     os.environ["ZOHO_CLIENT_ID"],
        "client_secret": os.environ["ZOHO_CLIENT_SECRET"],
        "refresh_token": os.environ["ZOHO_REFRESH_TOKEN"],
    })
    r.raise_for_status()
    return r.json()["access_token"]


def coql(token, query):
    r = requests.post(ZOHO_COQL_URL,
        headers={"Authorization": f"Zoho-oauthtoken {token}", "Content-Type": "application/json"},
        json={"select_query": query})
    data = r.json()
    if "data" not in data:
        print(f"COQL warning: {data}")
        return []
    return data["data"]


def build_tasks_js(rows, today):
    out = []
    for t in rows:
        subject = t.get("Subject", "").replace('"', '\\"')
        owner_raw = (t.get("Owner") or {}).get("name", "") if isinstance(t.get("Owner"), dict) else ""
        owner = OWNER_MAP.get(owner_raw, owner_raw)
        due = t.get("Due_Date") or ""
        status = "In Progress" if due and due <= today else "Not Due Yet"
        out.append(f'  {{s:"{subject}",st:"{status}",d:"{due}",c:"â",o:"{owner}"}}')
    return "const TASKS=[\n" + ",\n".join(out) + "\n];"


def build_pipe_js(all_deals):
    items = []
    for d in all_deals:
        amount = float(d.get("Amount") or 0)
        if amount <= 0:
            continue
        cn = d.get("Contact_Name")
        contact = (cn.get("name", "") if isinstance(cn, dict) else "") or d.get("Deal_Name", "")
        contact = contact.replace('"', '\\"')
        stage = d.get("Stage", "")
        dt = d.get("Closing_Date") or "â"
        ac = STAGE_ACTION.get(stage, "ð Action needed")
        items.append({"c": contact, "sg": stage, "a": amount, "dt": dt, "ac": ac})

    items.sort(key=lambda x: x["a"], reverse=True)
    js_items = [f'  {{c:"{p["c"]}",sg:"{p["sg"]}",a:{p["a"]},dt:"{p["dt"]}",ac:"{p["ac"]}"}}' for p in items]
    return "const PIPE=[\n" + ",\n".join(js_items) + "\n];"


def main():
    today = date.today().strftime("%Y-%m-%d")
    today_label = date.today().strftime("%b %d, %Y")
    print(f"Updating dashboard for {today}")

    token = get_token()
    print("Zoho token obtained")

    # Pull tasks
    tasks = coql(token, "SELECT Subject, Status, Due_Date, Owner FROM Tasks WHERE Status != 'Completed' LIMIT 50")
    if not tasks:
        print("ERROR: No tasks returned â aborting to avoid blanking dashboard")
        return

    # Pull pipeline by stage
    quotes    = coql(token, "SELECT Deal_Name, Stage, Amount, Closing_Date, Contact_Name FROM Deals WHERE Stage = 'Quote Sent' LIMIT 60")
    booked    = coql(token, "SELECT Deal_Name, Stage, Amount, Closing_Date, Contact_Name FROM Deals WHERE Stage = 'Booked' LIMIT 60")
    stalling  = coql(token, "SELECT Deal_Name, Stage, Amount, Closing_Date, Contact_Name FROM Deals WHERE Stage = 'Stalling' LIMIT 60")
    tentative = coql(token, "SELECT Deal_Name, Stage, Amount, Closing_Date, Contact_Name FROM Deals WHERE Stage = 'Tentative Booking' LIMIT 60")
    all_deals = quotes + booked + stalling + tentative

    if not all_deals:
        print("ERROR: No deals returned â aborting to avoid blanking dashboard")
        return

    print(f"Fetched {len(tasks)} tasks, {len(all_deals)} deals")

    tasks_str = build_tasks_js(tasks, today)
    pipe_str  = build_pipe_js(all_deals)

    with open("index.html", "r", encoding="utf-8") as f:
        html = f.read()

    html = re.sub(r"const TASKS=\[.*?\];", tasks_str, html, flags=re.DOTALL)
    html = re.sub(r"const PIPE=\[.*?\];",  pipe_str,  html, flags=re.DOTALL)
    html = re.sub(r"const TODAY='[0-9-]+'", f"const TODAY='{today}'", html)
    html = re.sub(r"const Td=new Date\('[0-9-]+'", f"const Td=new Date('{today}'", html)
    html = re.sub(r"Data: Zoho CRM \(synced [^)]+\)", f"Data: Zoho CRM (synced {today})", html)
    html = re.sub(r"Synced [A-Za-z]+ \d+, \d+", f"Synced {today_label}", html)

    with open("index.html", "w", encoding="utf-8") as f:
        f.write(html)

    print(f"Dashboard updated successfully for {today}")


if __name__ == "__main__":
    main()
