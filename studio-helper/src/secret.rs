// SPDX-License-Identifier: Apache-2.0
//! `protect` and `unprotect`: keep a person's AI key unreadable on disk.
//!
//! Windows encrypts it for the person signed in (the Data Protection API), so a copy of the file is no use to another
//! account or on another computer. The words go in on standard input and come out on standard output, never on the command
//! line, where other programs could read them. The encrypted form is written as hexadecimal.

use std::io::Read;

use crate::say;

fn input() -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    std::io::stdin().take(64 * 1024).read_to_end(&mut data).map_err(|e| e.to_string())?;
    if data.is_empty() {
        return Err("There was nothing on standard input.".into());
    }
    Ok(data)
}

fn to_hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(text: &str) -> Option<Vec<u8>> {
    if text.len() % 2 != 0 || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).ok()).collect()
}

#[cfg(windows)]
fn convert(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    let source = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut made = CRYPT_INTEGER_BLOB::default();
    // SAFETY: `source` points at `data`, which outlives the call and is only read; Windows allocates `made`, which is copied
    // and then freed once.
    unsafe {
        if protect {
            CryptProtectData(&source, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut made)
        } else {
            CryptUnprotectData(&source, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut made)
        }
        .map_err(|e| format!("Windows could not {} it: {}", if protect { "protect" } else { "open" }, e.message()))?;
        let out = std::slice::from_raw_parts(made.pbData, made.cbData as usize).to_vec();
        std::ptr::write_bytes(made.pbData, 0, made.cbData as usize);
        let _ = LocalFree(Some(HLOCAL(made.pbData as *mut core::ffi::c_void)));
        Ok(out)
    }
}

#[cfg(not(windows))]
fn convert(_data: &[u8], _protect: bool) -> Result<Vec<u8>, String> {
    Err("Protecting a key needs Windows.".into())
}

pub fn protect() -> Result<(), String> {
    say(serde_json::json!({ "event": "protected", "data": to_hex(&convert(&input()?, true)?) }));
    Ok(())
}

pub fn unprotect() -> Result<(), String> {
    let text = String::from_utf8(input()?).map_err(|_| "That is not a protected key.")?;
    let data = from_hex(text.trim()).ok_or("That is not a protected key.")?;
    let words = String::from_utf8(convert(&data, false)?).map_err(|_| "That is not a protected key.")?;
    say(serde_json::json!({ "event": "unprotected", "text": words }));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hexadecimal_goes_both_ways() {
        assert_eq!(from_hex(&to_hex(&[0, 9, 255])), Some(vec![0, 9, 255]));
        assert_eq!(from_hex("abc"), None);
        assert_eq!(from_hex("zz"), None);
    }

    #[cfg(windows)]
    #[test]
    fn a_protected_key_comes_back_and_does_not_show_its_words() {
        let key = b"an invented key, not a real one";
        let kept = convert(key, true).unwrap();
        assert!(!kept.windows(8).any(|w| w == &key[..8]));
        assert_eq!(convert(&kept, false).unwrap(), key);
        assert!(convert(b"not protected", false).is_err());
    }
}
