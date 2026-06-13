//! 日志系统：同时输出到 stdout（开发控制台）与按天滚动的日志文件。
//!
//! 日志文件位于 `<日志目录>/photo-browser.log.<日期>`，按环境隔离。
//! 级别可用环境变量 `RUST_LOG` 覆盖（如 `RUST_LOG=debug`）。
//!
//! 采用阻塞式写入：每条日志即时落盘，进程退出时不会丢失缓冲内容
//! （本应用日志量很小，阻塞写入开销可忽略）。

use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// 初始化全局日志。重复调用安全（只有首次生效）。
pub fn init() {
    let dir = crate::cache::logs_dir();
    let file_appender = tracing_appender::rolling::daily(&dir, "photo-browser.log");

    // 默认：本 crate 在 dev 下 debug、prod 下 info；其余依赖只看 warn。可用 RUST_LOG 覆盖。
    let default = if cfg!(debug_assertions) {
        "photo_browser_lib=debug,warn"
    } else {
        "photo_browser_lib=info,warn"
    };
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default));

    let stdout_layer = fmt::layer().with_target(false);
    let file_layer = fmt::layer()
        .with_ansi(false)
        .with_target(false)
        .with_writer(file_appender);

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(stdout_layer)
        .with(file_layer)
        .try_init();

    tracing::info!(
        env = crate::cache::ENV_NAME,
        data_dir = %crate::cache::data_dir().display(),
        cache_dir = %crate::cache::cache_dir().display(),
        log_dir = %dir.display(),
        "日志系统已初始化"
    );
}
