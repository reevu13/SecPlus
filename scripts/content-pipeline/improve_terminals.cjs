/**
 * improve_terminals.cjs
 * 
 * Enhances the pipeline-generated terminal_sim cards by making their patterns
 * more robust and their hints/success_messages more instructional.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LESSONS_DIR = path.resolve(REPO_ROOT, 'content/chapter_lessons');

function enhanceTerminalSim(payload, cardText) {
  let updated = false;

  // Sometimes the pipeline generated fallback commands like `help` or `--help`. 
  // Let's contextualize them based on text.
  const t = cardText.toLowerCase();
  
  // If it's a generic help fallback, try to guess a better command from context
  if (payload.commands.length === 1 && payload.commands[0].pattern === '^(help|man|--help)$') {
    if (t.includes('nmap') || t.includes('scan')) {
      payload.scenario = 'Run a basic network scan using nmap.';
      payload.commands[0] = {
        pattern: '^nmap\\s+.*$',
        success_message: '✓ Correct: Nmap is the standard network mapping tool.',
        hint: 'Use `nmap <target>`'
      };
      updated = true;
    } else if (t.includes('ssh') || t.includes('secure shell')) {
      payload.scenario = 'Connect to a remote server using SSH.';
      payload.commands[0] = {
        pattern: '^ssh\\s+.*$',
        success_message: '✓ Correct: SSH provides an encrypted channel for remote administration.',
        hint: 'Use `ssh <user>@<host>`'
      };
      updated = true;
    } else if (t.includes('ping') || t.includes('icmp')) {
      payload.scenario = 'Check if a remote host is reachable.';
      payload.commands[0] = {
        pattern: '^ping\\s+.*$',
        success_message: '✓ Correct: Ping sends ICMP echo requests to test connectivity.',
        hint: 'Use `ping <target>`'
      };
      updated = true;
    } else if (t.includes('chmod') || t.includes('permissions')) {
      payload.scenario = 'Change file permissions on a Unix system.';
      payload.commands[0] = {
        pattern: '^chmod\\s+.*$',
        success_message: '✓ Correct: chmod modifies file access permissions.',
        hint: 'Try `chmod <perms> <file>`'
      };
      updated = true;
    } else if (t.includes('grep') || t.includes('search')) {
      payload.scenario = 'Search for a string within a file.';
      payload.commands[0] = {
        pattern: '^grep\\s+.*$',
        success_message: '✓ Correct: grep searches standard input or files for matching text lines.',
        hint: 'Use `grep <pattern> <file>`'
      };
      updated = true;
    } else if (t.includes('systemctl') || t.includes('service')) {
       payload.scenario = 'Check the status of a systemd service.';
       payload.commands[0] = {
         pattern: '^systemctl\\s+(status|start|stop|restart)\\s+.*$',
         success_message: '✓ Correct: systemctl manages systemd services.',
         hint: 'Try `systemctl status <service>`'
       };
       updated = true;
    }
  }

  // Go through all commands and fix any overly strict regex escaping from the pipeline
  payload.commands.forEach(cmd => {
    if (cmd.pattern && cmd.pattern.includes('\\\\s+')) {
      cmd.pattern = cmd.pattern.replace(/\\\\s\+/g, '\\s+');
      updated = true;
    }
    
    // Make sure patterns are anchored to roughly match the whole command
    if (!cmd.pattern.startsWith('^') && !cmd.pattern.includes('.*')) {
       cmd.pattern = `^${cmd.pattern}\\s*.*$`;
       updated = true;
    }
  });

  return updated;
}

function main() {
  const files = fs.readdirSync(LESSONS_DIR).filter(f => f.endsWith('.lesson.json'));
  let updatedCards = 0;

  for (const file of files) {
    const filePath = path.join(LESSONS_DIR, file);
    const lesson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let fileUpdated = false;

    for (const mod of lesson.modules || []) {
      for (const page of mod.pages || []) {
        for (const card of page.cards || []) {
          if (card.interaction_type === 'terminal_sim' && card.interaction_payload) {
            if (enhanceTerminalSim(card.interaction_payload, card.text)) {
              updatedCards++;
              fileUpdated = true;
            }
          }
        }
      }
    }

    if (fileUpdated) {
      fs.writeFileSync(filePath, JSON.stringify(lesson, null, 2), 'utf8');
      console.log(`Updated terminal sims in ${file}`);
    }
  }

  console.log(`\n🎉 Improved ${updatedCards} terminal_sim payloads across all files.`);
}

main();
