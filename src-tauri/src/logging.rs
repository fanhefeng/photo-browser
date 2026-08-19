//! 日志系统：同时输出到 stdout（开发控制台）与按天滚动的日志文件。
//!
//! 日志文件位于 `<日志目录>/photo-browser.log.<日期>`，按环境隔离。
//! 级别可用环境变量 `RUST_LOG` 覆盖（如 `RUST_LOG=debug`）。
//!
//! 采用阻塞式写入：每条日志即时落盘，进程退出时不会丢失缓冲内容
//! （本应用日志量很小，阻塞写入开销可忽略）。

use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// 日志文件保留天数（按天滚动，超出的最旧文件由 appender 自动删除）。
const KEEP_DAYS: usize = 14;

/// 初始化全局日志。重复调用安全（只有首次生效）。
pub fn init() {
    let dir = crate::cache::logs_dir();
    // 保留最近 KEEP_DAYS 个日志文件：daily 滚动本身不会删旧文件，
    // 不设上限的话日志目录只增不减（长期使用会攒下几百个文件）。
    // 文件名格式与旧版一致（photo-browser.log.<日期>），历史日志照常可读。
    let file_appender = tracing_appender::rolling::RollingFileAppender::builder()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("photo-browser.log")
        .max_log_files(KEEP_DAYS)
        .build(&dir);

    // 默认：本 crate 在 dev 下 debug、prod 下 info；其余依赖只看 warn。可用 RUST_LOG 覆盖。
    let default = if cfg!(debug_assertions) {
        "photo_browser_lib=debug,warn"
    } else {
        "photo_browser_lib=info,warn"
    };
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default));

    let stdout_layer = fmt::layer().with_target(false);
    // 日志目录不可写等情况下 build 会失败：宁可只留 stdout，也不能让日志把启动带崩。
    let file_layer = file_appender.ok().map(|w| {
        fmt::layer()
            .with_ansi(false)
            .with_target(false)
            .with_writer(w)
    });

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
