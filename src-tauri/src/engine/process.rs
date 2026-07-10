use std::{
    io::{self, Read},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use crate::models::ProcessOutput;

#[derive(Debug, Clone)]
pub struct ProcessSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub envs: Vec<(String, String)>,
    pub timeout: Duration,
    pub cancellation: Option<Arc<AtomicBool>>,
}

pub trait ProcessRunner {
    fn run(&self, spec: &ProcessSpec) -> io::Result<ProcessOutput>;
}

pub struct SystemProcessRunner;

impl ProcessRunner for SystemProcessRunner {
    fn run(&self, spec: &ProcessSpec) -> io::Result<ProcessOutput> {
        let mut command = Command::new(&spec.program);
        command
            .args(&spec.args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_command_environment(&mut command, &spec.envs);

        let mut child = command.spawn()?;
        let stdout = read_pipe(child.stdout.take());
        let stderr = read_pipe(child.stderr.take());
        let deadline = Instant::now() + spec.timeout;
        let (status, timed_out, cancelled) = loop {
            if let Some(status) = child.try_wait()? {
                break (status, false, false);
            }
            if spec
                .cancellation
                .as_ref()
                .is_some_and(|cancellation| cancellation.load(Ordering::Relaxed))
            {
                let _ = child.kill();
                break (child.wait()?, false, true);
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                break (child.wait()?, true, false);
            }
            thread::sleep(Duration::from_millis(25));
        };

        let stdout = stdout.join().unwrap_or_default();
        let mut stderr = stderr.join().unwrap_or_default();
        if timed_out {
            if !stderr.is_empty() {
                stderr.push('\n');
            }
            stderr.push_str(&format!(
                "internal engine timed out after {} ms",
                spec.timeout.as_millis()
            ));
        } else if cancelled {
            if !stderr.is_empty() {
                stderr.push('\n');
            }
            stderr.push_str("internal engine cancelled");
        }

        Ok(ProcessOutput {
            stdout,
            stderr,
            exit_code: status.code(),
            success: status.success() && !timed_out && !cancelled,
            timed_out,
        })
    }
}

pub fn configure_command_environment(command: &mut Command, envs: &[(String, String)]) {
    command.env_clear();
    for key in [
        "HOME",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "__CF_USER_TEXT_ENCODING",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command.envs(envs.iter().map(|(key, value)| (key, value)));
}

fn read_pipe<R>(reader: Option<R>) -> thread::JoinHandle<String>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let Some(mut reader) = reader else {
            return String::new();
        };
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output);
        output
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeProcessRunner {
        output: ProcessOutput,
    }

    impl ProcessRunner for FakeProcessRunner {
        fn run(&self, _spec: &ProcessSpec) -> io::Result<ProcessOutput> {
            Ok(self.output.clone())
        }
    }

    #[test]
    fn fake_runner_returns_process_output_without_spawning() {
        let runner = FakeProcessRunner {
            output: ProcessOutput {
                stdout: "device".to_string(),
                stderr: String::new(),
                exit_code: Some(0),
                success: true,
                timed_out: false,
            },
        };

        let output = runner
            .run(&ProcessSpec {
                program: PathBuf::from("/does/not/run"),
                args: vec!["-l".to_string()],
                envs: Vec::new(),
                timeout: Duration::from_secs(1),
                cancellation: None,
            })
            .expect("fake runner should not fail");

        assert!(output.success);
        assert_eq!(output.stdout, "device");
    }

    #[test]
    fn system_runner_terminates_process_at_timeout() {
        let runner = SystemProcessRunner;
        let output = runner
            .run(&ProcessSpec {
                program: PathBuf::from("/bin/sleep"),
                args: vec!["1".to_string()],
                envs: Vec::new(),
                timeout: Duration::from_millis(10),
                cancellation: None,
            })
            .expect("sleep process should start");

        assert!(output.timed_out);
        assert!(!output.success);
        assert!(output.stderr.contains("timed out"));
    }

    #[test]
    fn system_runner_terminates_process_when_cancelled() {
        let runner = SystemProcessRunner;
        let cancellation = Arc::new(AtomicBool::new(false));
        let cancellation_for_thread = Arc::clone(&cancellation);
        let cancel_thread = thread::spawn(move || {
            thread::sleep(Duration::from_millis(20));
            cancellation_for_thread.store(true, Ordering::Relaxed);
        });

        let output = runner
            .run(&ProcessSpec {
                program: PathBuf::from("/bin/sleep"),
                args: vec!["1".to_string()],
                envs: Vec::new(),
                timeout: Duration::from_secs(2),
                cancellation: Some(cancellation),
            })
            .expect("sleep process should start");
        cancel_thread.join().expect("cancel thread should finish");

        assert!(!output.success);
        assert!(!output.timed_out);
        assert!(output.stderr.contains("cancelled"));
    }
}
