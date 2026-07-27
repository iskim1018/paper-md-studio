pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // 파일 관리자로 폴더 열기·파일 위치 표시. shell 플러그인의 open은
        // 2.1.0부터 deprecated이고 기본 스코프가 URL만 허용해 경로에 못 쓴다.
        .plugin(tauri_plugin_opener::init());

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
