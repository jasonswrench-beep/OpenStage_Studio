// SPDX-License-Identifier: Apache-2.0
//! `uia`: the accessibility driver's hands. It finds a program's controls the way a screen reader does (Windows UI
//! Automation) and works them through the same interface: pressing a button, setting a box's words, choosing from a list.
//! The real mouse and keyboard are never used.
//!
//! It reads one JSON command per line on standard input and answers each with one JSON line:
//!
//! * `{"cmd":"attach","window":"<part of the title>"}`: find the window (again, after the program was restarted).
//! * `{"cmd":"list"}`: every control in the window: automation id, name, role, place, and state.
//! * `{"cmd":"do","key":{...},"action":"invoke"|"focus"|"setValue"|"append"|"choose","value":"..."}`: work one control, found by
//!   `{"id":"<automation id>"}` or `{"role":"button","name":"Save lesson"}`.
//! * `{"cmd":"focused"}`: the control with the keyboard focus, if it is in the window.
//!
//! For a script step in another program's window (a step with `window`, which goes with the demo-mode hook), the window is named in
//! the command itself and the attached window is left as it was:
//!
//! * `{"cmd":"locate","window":"<part of the title>","key":{...}}`: where that control is on the whole desktop (`rect`, in screen
//!   pixels), its name and role, whether it shows and is switched on, and the display the window is on (`display`).
//! * `{"cmd":"press","window":"<part of the title>","key":{...},"action":"invoke"|"append"|"choose","value":"..."}`: work it.

use crate::say;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::BufRead;

#[derive(Deserialize, Default)]
struct Key {
    id: Option<String>,
    role: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct Command {
    cmd: String,
    #[serde(default)]
    window: Option<String>,
    #[serde(default)]
    key: Option<Key>,
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    value: Option<String>,
}

/// A control's role in plain words, from its control type (the same words the demo hook uses where it can).
pub fn role_of(control_type: i32) -> &'static str {
    match control_type {
        50000 => "button",
        50002 => "checkbox",
        50003 => "combobox",
        50004 => "textbox",
        50005 => "link",
        50007 => "listitem",
        50008 => "list",
        50009 => "menu",
        50011 => "menuitem",
        50013 => "radio",
        50015 => "slider",
        50019 => "tab",
        50024 => "treeitem",
        50031 => "button",
        50020 => "text",
        _ => "",
    }
}

/// Whether a role is one a script may act on (and so is listed).
pub fn actionable(role: &str) -> bool {
    matches!(role, "button" | "checkbox" | "combobox" | "textbox" | "link" | "listitem" | "list" | "menuitem" | "radio" | "slider" | "tab" | "treeitem")
}

/// Whether two names are the same name: case and spacing aside.
pub fn same_name(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    norm(a) == norm(b)
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows::core::{BOOL, BSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::UI::Accessibility::*;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible};

    pub struct Session {
        automation: IUIAutomation,
        root: Option<IUIAutomationElement>,
    }

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let found = &mut *(lparam.0 as *mut Vec<(HWND, String)>);
        if IsWindowVisible(hwnd).as_bool() {
            let len = GetWindowTextLengthW(hwnd);
            if len > 0 {
                let mut buf = vec![0u16; len as usize + 1];
                let n = GetWindowTextW(hwnd, &mut buf);
                found.push((hwnd, String::from_utf16_lossy(&buf[..n as usize])));
            }
        }
        BOOL(1)
    }

    fn rect_of(r: RECT, origin: RECT) -> [i32; 4] {
        [r.left - origin.left, r.top - origin.top, (r.right - r.left).max(0), (r.bottom - r.top).max(0)]
    }

    impl Session {
        pub fn new() -> Result<Self, String> {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| format!("Windows' accessibility interface could not be started: {e}"))?;
                Ok(Self { automation, root: None })
            }
        }

        /// The open window whose title is `title` (case aside), or else the first, front to back, whose title has it in it.
        fn window(&self, title: &str) -> Result<(HWND, String, IUIAutomationElement), String> {
            let mut found: Vec<(HWND, String)> = Vec::new();
            unsafe {
                let _ = EnumWindows(Some(collect), LPARAM(&mut found as *mut _ as isize));
            }
            let want = title.trim().to_lowercase();
            let at = found
                .iter()
                .position(|(_, t)| t.trim().to_lowercase() == want)
                .or_else(|| found.iter().position(|(_, t)| t.to_lowercase().contains(&want)))
                .ok_or_else(|| format!("No open window's title has \"{title}\" in it."))?;
            let (hwnd, name) = found.swap_remove(at);
            let root = unsafe { self.automation.ElementFromHandle(hwnd) }.map_err(|e| format!("The window \"{name}\" could not be read: {e}"))?;
            Ok((hwnd, name, root))
        }

        pub fn attach(&mut self, title: &str) -> Result<Value, String> {
            let (_, name, root) = self.window(title)?;
            let r = unsafe { root.CurrentBoundingRectangle() }.map_err(|e| e.to_string())?;
            self.root = Some(root);
            Ok(json!({ "window": name, "width": r.right - r.left, "height": r.bottom - r.top }))
        }

        /// Where a control of another window is on the whole desktop, and the display that window is on.
        pub fn locate(&self, title: &str, key: &Key) -> Result<Value, String> {
            let (hwnd, name, root) = self.window(title)?;
            let el = self.find_in(&root, key)?;
            let desktop = RECT::default();
            let mut info = self.describe_any(&el, desktop).ok_or("The control could not be read.")?;
            let mut m = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            let display = unsafe {
                let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                GetMonitorInfoW(monitor, &mut m).as_bool().then(|| {
                    let r = m.rcMonitor;
                    json!([r.left, r.top, r.right - r.left, r.bottom - r.top])
                })
            };
            info["window"] = json!(name);
            info["display"] = display.unwrap_or(Value::Null);
            Ok(info)
        }

        /// Work a control of another window, leaving the attached window as it was.
        pub fn act_in(&self, title: &str, key: &Key, action: &str, value: Option<&str>) -> Result<Value, String> {
            let (_, _, root) = self.window(title)?;
            let el = self.find_in(&root, key)?;
            self.act_on(&el, action, value)
        }

        fn root(&self) -> Result<&IUIAutomationElement, String> {
            self.root.as_ref().ok_or_else(|| "No window is attached yet.".to_string())
        }

        fn all(&self) -> Result<Vec<IUIAutomationElement>, String> {
            self.all_in(self.root()?)
        }

        fn all_in(&self, root: &IUIAutomationElement) -> Result<Vec<IUIAutomationElement>, String> {
            unsafe {
                let cond = self.automation.CreateTrueCondition().map_err(|e| e.to_string())?;
                let found = root.FindAll(TreeScope_Descendants, &cond).map_err(|e| format!("The window's controls could not be read: {e}"))?;
                let n = found.Length().map_err(|e| e.to_string())?;
                Ok((0..n).filter_map(|i| found.GetElement(i).ok()).collect())
            }
        }

        fn describe(&self, el: &IUIAutomationElement, origin: RECT) -> Option<Value> {
            let role = role_of(unsafe { el.CurrentControlType() }.ok()?.0);
            if !actionable(role) {
                return None;
            }
            self.describe_any(el, origin)
        }

        /// A control's id, name, role, place (from `origin`) and state, whatever its role.
        fn describe_any(&self, el: &IUIAutomationElement, origin: RECT) -> Option<Value> {
            unsafe {
                let role = role_of(el.CurrentControlType().ok()?.0);
                let id = el.CurrentAutomationId().map(|b| b.to_string()).unwrap_or_default();
                let name = el.CurrentName().map(|b| b.to_string()).unwrap_or_default();
                if id.is_empty() && name.trim().is_empty() {
                    return None;
                }
                let r = el.CurrentBoundingRectangle().ok()?;
                let rect = rect_of(r, origin);
                let offscreen = el.CurrentIsOffscreen().map(|b| b.as_bool()).unwrap_or(false);
                let password = el.CurrentIsPassword().map(|b| b.as_bool()).unwrap_or(false);
                let value = if password {
                    None
                } else {
                    el.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId).ok().and_then(|p| p.CurrentValue().ok()).map(|b| b.to_string())
                };
                Some(json!({
                    "id": id, "name": name.trim(), "role": role, "rect": rect,
                    "visible": !offscreen && rect[2] > 0 && rect[3] > 0,
                    "enabled": el.CurrentIsEnabled().map(|b| b.as_bool()).unwrap_or(true),
                    "focused": el.CurrentHasKeyboardFocus().map(|b| b.as_bool()).unwrap_or(false),
                    "value": value,
                }))
            }
        }

        pub fn list(&self) -> Result<Value, String> {
            let origin = unsafe { self.root()?.CurrentBoundingRectangle() }.map_err(|e| e.to_string())?;
            let controls: Vec<Value> = self.all()?.iter().filter_map(|e| self.describe(e, origin)).collect();
            Ok(json!({ "viewport": [origin.right - origin.left, origin.bottom - origin.top], "controls": controls }))
        }

        pub fn focused(&self) -> Result<Value, String> {
            let origin = unsafe { self.root()?.CurrentBoundingRectangle() }.map_err(|e| e.to_string())?;
            let found = self.all()?.into_iter().find(|e| unsafe { e.CurrentHasKeyboardFocus().map(|b| b.as_bool()).unwrap_or(false) });
            Ok(json!({ "control": found.and_then(|e| self.describe(&e, origin)) }))
        }

        fn find(&self, key: &Key) -> Result<IUIAutomationElement, String> {
            self.find_in(self.root()?, key)
        }

        fn find_in(&self, root: &IUIAutomationElement, key: &Key) -> Result<IUIAutomationElement, String> {
            let mut matches: Vec<(IUIAutomationElement, bool)> = Vec::new();
            for el in self.all_in(root)? {
                unsafe {
                    let ok = if let Some(id) = &key.id {
                        el.CurrentAutomationId().map(|b| b.to_string() == *id).unwrap_or(false)
                    } else {
                        let role = el.CurrentControlType().map(|t| role_of(t.0)).unwrap_or("");
                        let name = el.CurrentName().map(|b| b.to_string()).unwrap_or_default();
                        key.role.as_deref().map(|r| r == role).unwrap_or(true) && key.name.as_deref().map(|n| same_name(n, &name)).unwrap_or(false)
                    };
                    if ok {
                        let shown = !el.CurrentIsOffscreen().map(|b| b.as_bool()).unwrap_or(false);
                        matches.push((el, shown));
                    }
                }
            }
            let words = key.id.clone().map(|i| format!("\"{i}\"")).unwrap_or_else(|| format!("the {} called \"{}\"", key.role.as_deref().unwrap_or("control"), key.name.as_deref().unwrap_or("")));
            // A control on screen first; any match otherwise.
            matches.sort_by_key(|(_, shown)| !*shown);
            matches.into_iter().next().map(|(e, _)| e).ok_or_else(|| format!("There is no control {words} in the window."))
        }

        pub fn act(&self, key: &Key, action: &str, value: Option<&str>) -> Result<Value, String> {
            let el = self.find(key)?;
            self.act_on(&el, action, value)
        }

        fn act_on(&self, el: &IUIAutomationElement, action: &str, value: Option<&str>) -> Result<Value, String> {
            let el = el.clone();
            unsafe {
                if !el.CurrentIsEnabled().map(|b| b.as_bool()).unwrap_or(true) {
                    return Err("The control is switched off.".into());
                }
                match action {
                    "focus" => el.SetFocus().map_err(|e| format!("The control could not take the focus: {e}"))?,
                    "setValue" => {
                        let p: IUIAutomationValuePattern = el.GetCurrentPatternAs(UIA_ValuePatternId).map_err(|_| "The control does not take typed words.".to_string())?;
                        p.SetValue(&BSTR::from(value.unwrap_or(""))).map_err(|e| format!("The words could not be set: {e}"))?;
                    }
                    "append" => {
                        // Add to the end of the box's words: typing, one piece at a time.
                        let p: IUIAutomationValuePattern = el.GetCurrentPatternAs(UIA_ValuePatternId).map_err(|_| "The control does not take typed words.".to_string())?;
                        let now = p.CurrentValue().map(|b| b.to_string()).unwrap_or_default();
                        p.SetValue(&BSTR::from(format!("{now}{}", value.unwrap_or("")))).map_err(|e| format!("The words could not be typed: {e}"))?;
                    }
                    "choose" => self.choose(&el, value.unwrap_or(""))?,
                    "invoke" => self.press(&el)?,
                    other => return Err(format!("\"{other}\" is not something the accessibility driver does.")),
                }
            }
            Ok(json!({ "done": true }))
        }

        /// Press a control as a screen reader user would: its main action, whichever pattern it offers.
        unsafe fn press(&self, el: &IUIAutomationElement) -> Result<(), String> {
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) {
                return p.Invoke().map_err(|e| format!("The control could not be pressed: {e}"));
            }
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId) {
                return p.Toggle().map_err(|e| format!("The control could not be switched: {e}"));
            }
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId) {
                return p.Select().map_err(|e| format!("The item could not be chosen: {e}"));
            }
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId) {
                let state = p.CurrentExpandCollapseState().map_err(|e| e.to_string())?;
                return if state == ExpandCollapseState_Collapsed { p.Expand() } else { p.Collapse() }.map_err(|e| format!("The control could not be opened or closed: {e}"));
            }
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationLegacyIAccessiblePattern>(UIA_LegacyIAccessiblePatternId) {
                return p.DoDefaultAction().map_err(|e| format!("The control could not be pressed: {e}"));
            }
            Err("The control offers no way to be pressed without the mouse.".into())
        }

        /// Choose an item of a drop-down list by its words.
        unsafe fn choose(&self, el: &IUIAutomationElement, text: &str) -> Result<(), String> {
            let cond = self.automation.CreateTrueCondition().map_err(|e| e.to_string())?;
            let find_item = || -> Option<IUIAutomationElement> {
                let items = el.FindAll(TreeScope_Descendants, &cond).ok()?;
                let n = items.Length().ok()?;
                (0..n).filter_map(|i| items.GetElement(i).ok()).find(|it| {
                    it.CurrentControlType().map(|t| t.0 == 50007).unwrap_or(false) && it.CurrentName().map(|b| same_name(&b.to_string(), text)).unwrap_or(false)
                })
            };
            let chosen = || -> bool {
                el.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                    .ok()
                    .and_then(|p| p.CurrentValue().ok())
                    .map(|v| same_name(&v.to_string(), text))
                    .unwrap_or(false)
            };
            let settle = || std::thread::sleep(std::time::Duration::from_millis(150));
            if chosen() {
                return Ok(());
            }
            let expand = el.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId).ok();
            let close = || {
                if let Some(p) = &expand {
                    if p.CurrentExpandCollapseState().map(|s| s != ExpandCollapseState_Collapsed).unwrap_or(false) {
                        let _ = p.Collapse();
                    }
                }
            };
            // Each way a list may offer to be chosen from, in turn, until the list says the choice is made.
            let mut item = find_item();
            if item.is_none() {
                if let Some(p) = &expand {
                    let _ = p.Expand();
                    settle();
                    item = find_item();
                }
            }
            if let Some(it) = &item {
                if let Ok(p) = it.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId) {
                    let _ = p.Select();
                    settle();
                    if chosen() {
                        close();
                        return Ok(());
                    }
                }
                if let Ok(p) = it.GetCurrentPatternAs::<IUIAutomationLegacyIAccessiblePattern>(UIA_LegacyIAccessiblePatternId) {
                    let _ = p.DoDefaultAction();
                    settle();
                    if chosen() {
                        close();
                        return Ok(());
                    }
                }
                if let Ok(p) = it.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) {
                    let _ = p.Invoke();
                    settle();
                    if chosen() {
                        close();
                        return Ok(());
                    }
                }
            }
            close();
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) {
                let _ = p.SetValue(&BSTR::from(text));
                settle();
                if chosen() {
                    return Ok(());
                }
            }
            Err(if item.is_some() {
                format!("The choice \"{text}\" is in the list, but the list would not take it without the mouse.")
            } else {
                format!("The list has no choice called \"{text}\".")
            })
        }
    }
}

#[cfg(windows)]
pub fn run() -> Result<(), String> {
    let mut s = win::Session::new()?;
    say(json!({ "event": "ready" }));
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let answer = match serde_json::from_str::<Command>(&line) {
            Err(e) => Err(format!("The command could not be read: {e}")),
            Ok(c) => match c.cmd.as_str() {
                "attach" => s.attach(c.window.as_deref().unwrap_or("")),
                "list" => s.list(),
                "focused" => s.focused(),
                "do" => s.act(&c.key.unwrap_or_default(), c.action.as_deref().unwrap_or("invoke"), c.value.as_deref()),
                "locate" => s.locate(c.window.as_deref().unwrap_or(""), &c.key.unwrap_or_default()),
                "press" => s.act_in(c.window.as_deref().unwrap_or(""), &c.key.unwrap_or_default(), c.action.as_deref().unwrap_or("invoke"), c.value.as_deref()),
                other => Err(format!("\"{other}\" is not a command of the accessibility driver.")),
            },
        };
        match answer {
            Ok(v) => say(json!({ "ok": true, "result": v })),
            Err(e) => say(json!({ "ok": false, "error": e })),
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn run() -> Result<(), String> {
    Err("The accessibility driver needs Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_and_names() {
        assert_eq!(role_of(50000), "button");
        assert_eq!(role_of(50004), "textbox");
        assert!(actionable("combobox") && !actionable("text") && !actionable(""));
        assert!(same_name("Save  lesson", "save lesson"));
        assert!(!same_name("Save", "Save lesson"));
    }
}
