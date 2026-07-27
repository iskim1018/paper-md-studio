pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    // 업데이터는 데스크톱 전용. process 플러그인은 업데이트 설치 후
    // 앱을 재시작(relaunch)하는 데 필요하다.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .run(tauri::generate_context!())
        .expect("Tauri 앱 실행 중 오류 발생");
}
