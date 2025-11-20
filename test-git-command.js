const { spawn } = require('child_process');
const path = require('path');

class GitTest {
  async execGitCommand(args, cwd) {
    return new Promise((resolve, reject) => {
      // 确保路径是绝对路径
      const absolutePath = path.resolve(cwd);

      const child = spawn('git', args, {
        cwd: absolutePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_DIR: `${absolutePath}/.git`,
          GIT_WORK_TREE: absolutePath,
        },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log(`命令输出: ${stdout.trim()}`);
          resolve(stdout.trim());
        } else {
          reject(new Error(`Git命令执行失败 (退出码: ${code}): ${stderr}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`无法执行git命令: ${err.message}`));
      });
    });
  }

  async test() {
    const args = ['log', '--format=%cd', '--date=format:%Y-%m-%d', '-1'];
    const gitPath = '/Volumes/data/code/github.com/cloudyan/qwen-code';

    try {
      const result = await this.execGitCommand(args, gitPath);
      console.log('测试成功，结果:', result);
    } catch (error) {
      console.error('测试失败:', error.message);
    }
  }
}

const tester = new GitTest();
tester.test();

// test
// node test-git-command.js
