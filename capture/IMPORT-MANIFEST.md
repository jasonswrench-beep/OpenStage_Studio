# Import manifest: the capture engine

Copied from OpenScreen, the recorder inside OpenStage Author (`jasonswrench-beep/openstage-author`, main, commit
`3c47a83ab4495e1b9f4a6f0cfaf996d4e4fbb1fc`, 2026-11-14), folder `capture/`. Apache License 2.0, same owner. The paths are
the same as in OpenStage Author, so a fix in one can be carried to the other by comparing like with like.

Only the wording listed at the end was changed. Studio uses it through `studio-helper/`, which depends on these crates by path. Change a file
here only when Studio needs it, say so in the summary, and record it at the end of this file, because every change is a
difference someone has to carry back.

Not copied: the engine's double-click test scripts, `tools/check_rules.py` and `ci/`, which belong to OpenStage Author's
own workflow.

| File | SHA-256 |
|---|---|
| `Cargo.lock` | `2c7b8f3b777e80f10dd09b3d0b2b74d5025318ca531741bc49a385b48ea46944` |
| `Cargo.toml` | `7466dc9549e9d3c19b0918d51cc7fd1240319350193df7e763b92b0d497aae67` |
| `THIRD-PARTY.md` | `931adbbc09d869bd7c4353926dab37ed13874e7d48896c93a49e1b220f150671` |
| `crates/openstage-capture-cli/Cargo.toml` | `366ebd775c8a5c1d5d50f636224fe76774db1d760985dceb71170d4a20e67232` |
| `crates/openstage-capture-cli/src/checks.rs` | `a730b312fd88001e109361212165955431beb14f92bbb145bac46f64ea8d0db1` |
| `crates/openstage-capture-cli/src/demo.rs` | `b8bfb80839176a40e32f93d6ad3f8c8c37d332483c38aba96f5c75a194d0d2ff` |
| `crates/openstage-capture-cli/src/interactions_cmd.rs` | `6ed7a9a4543ffea66e410f0982667b69556d6929b8cc0bbb8336136ded842d21` |
| `crates/openstage-capture-cli/src/main.rs` | `fef47a3c9374d8c29efd867107cd417f508c903fa205a51272486277dab95d3b` |
| `crates/openstage-capture-cli/src/plain.rs` | `f70813b23f33b10fcc22e911d930a5cae794ca15632238e6a58bb40141648f13` |
| `crates/openstage-capture-cli/tests/cli.rs` | `73b563a4c01293fe909ef47a2a22aca736c83c78e75b9bb10e59d3ccc53fd02d` |
| `crates/openstage-capture-project/Cargo.toml` | `dfca397370bf97bb5e9969e1141470963bc040e06654136b96f4b1979a888e43` |
| `crates/openstage-capture-project/src/edit.rs` | `df3740512b3ec1b995179f32b37b41d9c794e47af7f5dbbda290cd84ae95b7b3` |
| `crates/openstage-capture-project/src/error.rs` | `3af20ecbae232b29f3150850877d3c9f7da38e61052f5bcb62d9b4263b831a06` |
| `crates/openstage-capture-project/src/events_log.rs` | `fb82e61e7bf6ef48cd3126397e06da35b7c10d1efd8e4e1c5801f144740dffb2` |
| `crates/openstage-capture-project/src/fmp4.rs` | `928faa705410d6ffb4091fc6acf2c2872f54d021346276dcc7599c311cb00521` |
| `crates/openstage-capture-project/src/fsutil.rs` | `822e1eaa071df6144825055d71e7eddeb674a678e1e37b0dc9f6469c62813870` |
| `crates/openstage-capture-project/src/interaction_review.rs` | `0aaf1fd0713796a41dbcfb0c1ed0bf63d885162a2b3e2e17b14df55fc88e6c51` |
| `crates/openstage-capture-project/src/lib.rs` | `4cc76a962fbd4d1fdc1b38cf4528983c604ed94d5b707deafa75ac6d7285b395` |
| `crates/openstage-capture-project/src/manifest.rs` | `05765fe8bf37b61a1e98f08db32b8b505969faa0c76c1eefc44b560b7816454c` |
| `crates/openstage-capture-project/src/recover.rs` | `f76690e4daa17fa94da3e757461891dfa34b08b20c0afe68b998394f09db3ee6` |
| `crates/openstage-capture-project/src/segment.rs` | `888a9fc22b152f19b78843d2219509291faf7af489e5f7fec0b5eda83b89baf2` |
| `crates/openstage-capture-project/src/take.rs` | `199ba89923ab59dd23ba042b366abbfcb1ece74eb561b3a7831ee81f5df71479` |
| `crates/openstage-capture-project/src/wav.rs` | `1a442b9f8439d9e0ff19bbc193599a5753ddbe3aca7c1f6768cbe50aa9739151` |
| `crates/openstage-capture-protocol/Cargo.toml` | `793be7bd5bdf7650a28deed448e7b59893d206e764885b1ae17ca104ba43e902` |
| `crates/openstage-capture-protocol/src/lib.rs` | `958e3e50154954d240b6129f4ba0de9a33c3c4f8e4fc8e4aab7a05d8a671cfcd` |
| `crates/openstage-capture-render/Cargo.toml` | `b4238163ad4cd8f630c2b1b9253c1ac1dc9d1bdc90d2aea6ca9009ef3c0b4970` |
| `crates/openstage-capture-render/src/audio.rs` | `cb297b61a6f24884a8f633d09e17e2adcf95b388aeb5545cebf84118242be97a` |
| `crates/openstage-capture-render/src/canvas.rs` | `169236cf5ebd2a11ff8c0c0e6613139adfc30600a7cd5573f68c91a787817a40` |
| `crates/openstage-capture-render/src/compose.rs` | `b3c0baeeb6a4282d79546849e1317919e5d128d062cb07d09de684e71559aca2` |
| `crates/openstage-capture-render/src/cursor.rs` | `f8ed6b1b2b56a9f3d2a4efc102e3a92009d795d58c9ede6805647345004f4d17` |
| `crates/openstage-capture-render/src/lib.rs` | `5c6ad0bbdb86bb44bdebb8a711f3ec428d94ce94e407377301457310d1c06854` |
| `crates/openstage-capture-render/src/plan.rs` | `76ba84587e9dd979dd6f8a6707a73e3267ce98696adc0e64cc32018a7c9c5eef` |
| `crates/openstage-capture-render/src/png.rs` | `1b85fb8affa4e8bfcf619caa622b078be93ee009a53147df1d7c8c3e2c8001c0` |
| `crates/openstage-capture-render/src/text.rs` | `6f28f72045535844b345a69c8af0682aeb00d9ec53ae20636b505042646636a6` |
| `crates/openstage-capture-render/src/zoom.rs` | `9b2cad68653b79091295269ac2adb24c9168c0272eec8050abc0702acfa0dd71` |
| `crates/openstage-capture-windows/Cargo.toml` | `ea1cb44a0519e24a561807585056779dcb38e539716650cb8f3e7cb78231da66` |
| `crates/openstage-capture-windows/src/audio.rs` | `b4b811b9d2a2800d0ec7b80ce3355a63bb95222d079cade577fdcc08151f4d43` |
| `crates/openstage-capture-windows/src/balance.rs` | `9f88e8649bdf521ff7d7daf28f69854db43a6453281525c2a40444477a47742c` |
| `crates/openstage-capture-windows/src/bmp.rs` | `8e2a90df0cad01efbff1eb4e13843f0b7b27713c9f00c343548688feecc86a3b` |
| `crates/openstage-capture-windows/src/crash.rs` | `07ab13ce31c4ce50101de81ddc82e3e40096e0b59917dc8d01c74d081173c38f` |
| `crates/openstage-capture-windows/src/crash_words.rs` | `3dedd1c5996d0aace0392c395506fcf9d0c7dfaf7b008a63f83277271b095b77` |
| `crates/openstage-capture-windows/src/cue_player.rs` | `e054e0746af0b09ca047f14015b4788a4f8b2d05de7e817ccd71f11ddb5e790a` |
| `crates/openstage-capture-windows/src/cursor_track.rs` | `884047fe5b3f5f0dc7037bcf10aeb276fff061999e86045c24757f6405e7bb15` |
| `crates/openstage-capture-windows/src/echo.rs` | `e2492bfca46ad6c1bc9c85f2b2b79c0269d0da57e268619640922f2a20981074` |
| `crates/openstage-capture-windows/src/export.rs` | `2d652ddd84cd77b3f8ba2aafc1ce8655865ac4c8d340898238987c08fb0fe153` |
| `crates/openstage-capture-windows/src/hide.rs` | `a7a08e5bb6929d8fdcd5ada7468cd2005a807a7d2d18f0414b5b26b3968c4432` |
| `crates/openstage-capture-windows/src/interactions.rs` | `9d57cf52533854d547c8d5e0a00f1bee2d6247b736eb05f6302419b7a2c658f2` |
| `crates/openstage-capture-windows/src/lib.rs` | `c22fbaefe850573a3bf20de0c690ef74cb56789208b0bf16c329af9eed21399d` |
| `crates/openstage-capture-windows/src/make_edit.rs` | `b8c9167e05e7c29a26529b51f178195f07764bc979df1e11c68c7af063ccf4a4` |
| `crates/openstage-capture-windows/src/pick.rs` | `0e95abca30400d7862c7d8c637fd60482e8a9eee349795586930513c5aa2c438` |
| `crates/openstage-capture-windows/src/pick_window.rs` | `e90cb705895b86a047e45af7ad084b9d1c09b36949232b2643758329db4b33be` |
| `crates/openstage-capture-windows/src/queue.rs` | `d809acdc8dea24258d09da6721ab58ed043268bcdc8dcd5979edafc79f78d067` |
| `crates/openstage-capture-windows/src/record.rs` | `46f82514c49a191fa4ba235944618b4de8c4cdc381d74cd04f327a6704a96d88` |
| `crates/openstage-capture-windows/src/region.rs` | `7e2489b511fec14c3c0af94920d3e6dc000b45fa67aadb1203231e89a243a65d` |
| `crates/openstage-capture-windows/src/region_editor.rs` | `480dc1ed2f24ffd957b833e1ba709ccb7d604c2aa8c74dfaee57b35e7c6b4b5d` |
| `crates/openstage-capture-windows/src/region_paint.rs` | `356dab6740419f341ec89d43a886c3d4cb8056da2ac18b5b9f86d3f1bb398b82` |
| `crates/openstage-capture-windows/src/render_cmd.rs` | `b426dd3efedbdf93e03a09d14f646b86816d482cbe5bf3733d4514a83f7907df` |
| `crates/openstage-capture-windows/src/report.rs` | `d560e6bb5e35e4712014465edf3249dd499c45f0a3979a04d0f75fe797baef53` |
| `crates/openstage-capture-windows/src/setup.rs` | `7a601679890f98cec5c35743dfd1ae61634f99a4936b87cd8b2d19eaee69c5ea` |
| `crates/openstage-capture-windows/src/sound.rs` | `5362a81c78bfe050802c7cbaaf296a63dc5982a5943693ace42bac1c1ace2cb5` |
| `crates/openstage-capture-windows/src/stats.rs` | `dd4a7d43149469992c74d66670fbf84ff2856506ba333796f0af886efc3ea332` |
| `crates/openstage-capture-windows/src/timing.rs` | `bac1e3995a7949ac1c93a34d61e0bb81c2635b2ee1433dc3d6fce72a4ae707c9` |
| `crates/openstage-capture-windows/src/video.rs` | `057dd82cab2960fb3a45a1e32afc6843576cf2d1ecde8cdc58f2e6038fcc1032` |
| `crates/openstage-capture-windows/src/webcam.rs` | `0e700049903bd51f289d114e986ed06b44f4cf6fe7e9365a8855c02764b4a2f4` |
| `crates/openstage-capture-windows/src/win.rs` | `440a0d57171587b6a6af47db29ceb430b18d8f94099a2831c795ab2491cffcd8` |
| `crates/openstage-capture-windows/src/win_audio.rs` | `ee87f2334ae6ad9ed10118041c6ea1e8993ce8a846cdf4a2f39ce8fe05a9db10` |
| `crates/openstage-capture-windows/src/win_camera.rs` | `b90cc6c4d5c06ec17e0bc920c9ee125f62841866cfa4cb7d39d47ca130b316b3` |
| `crates/openstage-capture-windows/src/win_console.rs` | `6e7599afac525c9d919d5279128ca4e21aeb0d6d3aab867648f3fed046025392` |
| `crates/openstage-capture-windows/src/win_cues.rs` | `70c77b426b70913e7690cfd82c4a615d7164055ef78f674614b152425656f700` |
| `crates/openstage-capture-windows/src/win_interactions.rs` | `b8029f42306518bbf4a199e3360fea243262103c553a45b195e33767b0b095bd` |
| `crates/openstage-capture-windows/src/win_layered.rs` | `29e5290abbf58903d95fe4d7a09b5cb4bd5eee2df8c7aeda8023706ca422f829` |
| `crates/openstage-capture-windows/src/win_outline.rs` | `4449070c5968fed4c8d1dd196c4477c99c671ca44ae27ffa3bef1ea4aafff645` |
| `crates/openstage-capture-windows/src/win_pick_window.rs` | `b527ec3d5ec94588d8ce02afd0c7f557958eee1bc53b2c3d035b725eb621bf65` |
| `crates/openstage-capture-windows/src/win_pictures.rs` | `2a1b8e95b5a00c7c07d310101f501b5f4303f08ac8c742977609169d619bafce` |
| `crates/openstage-capture-windows/src/win_region.rs` | `6a449b2bf988c902e71b10a8ebb95560bd229877116b3e69dcc107d85ff99876` |
| `crates/openstage-capture-windows/src/win_setup.rs` | `93197393f5b90331301ac105830b6efbfba5b02f76dd137c63d247732e70dc95` |
| `crates/openstage-capture-windows/src/win_text.rs` | `36e52859e443f45ecd39fa576523abbc0dd7392616f69e0e1d355f8e01460518` |
| `crates/openstage-capture-windows/src/win_video.rs` | `08699ae2ae46ecf7ebde12e88d5f7fe1c07221e0abb1e0a22c36750fe555d045` |
| `crates/openstage-capture-windows/src/win_windows.rs` | `deaf527bceb4210f9b4f87da13486a78f80e1d4decbde9e7ec0dd827f5416c04` |
| `crates/openstage-capture-windows/src/window.rs` | `3a06894e8a618d86d158e9d57d66bd731cc351de9d1d22cecdbc406bd3a11a76` |
| `crates/openstage-capture-windows/src/yuv.rs` | `989c76658164b662c36fcad94e9a2c203076a9e0ba0ea75ab9a4ced32cbe0cf5` |
| `crates/openstage-capture/Cargo.toml` | `4021fbb404003f7d21d46402fb9af3f5fd170c927d44a7a149d96f9e5babe659` |
| `crates/openstage-capture/src/clock.rs` | `c4d449bd815a5852793cb68b510c69cc1d437b383c0e408a57869550b298c488` |
| `crates/openstage-capture/src/cues.rs` | `3b136624eace1894c36c185021ceda4eea50ee9f06bdbabb29c23da86d68bbd8` |
| `crates/openstage-capture/src/lib.rs` | `cb711ef9cddc308e4c9ddedde609df281572fe36bf34dcbf1602b571a9174f01` |
| `crates/openstage-capture/src/media.rs` | `02731ee24b455ae80e53a69caa7c7af69b21cf536ec72599b4ef80c2f2eec6d9` |
| `crates/openstage-capture/src/session.rs` | `1ea3305f44eaa010fd388e68f0a8a1ae99340cd8f5344b45b0adebcad39d99d3` |
| `crates/openstage-capture/src/source.rs` | `d3e3849bbafab7f54b99e48c2736f1ba5bc3b7771c7d31ad80671d2dbd01c20a` |
| `rustfmt.toml` | `e27d70e4fa1a9ff63a14b5e53a26bc35c5a277a25fc967a4252cb3866a0e1394` |

## Changes made in Studio

2026-11-14: product names taken out of comments and messages, at Jason's request (no commercial names anywhere in the
repository). The same edits are to be made in OpenStage Author's own copy so the two stay identical. The checksums above
are of the changed files.

- `crates/openstage-capture-windows/Cargo.toml`: the comment on the windows crate.
- `crates/openstage-capture-windows/src/setup.rs` and `src/video.rs`: the advice about the free Media Feature Pack.
- `crates/openstage-capture-windows/src/win.rs` and `src/win_pictures.rs`: two comments about the operating system's own samples.
- `crates/openstage-capture-windows/src/win_region.rs`: "screen readers" instead of two products by name.

Kept on purpose: the registry path in `src/win_setup.rs` (line 19), which the code needs to read Windows' privacy
settings and cannot be reworded.
