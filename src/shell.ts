'use strict';

import * as vscode from 'vscode';
import * as shelljs from 'shelljs';
import * as path from 'path';
import { host } from './host';

export enum Platform {
    Windows,
    MacOS,
    Linux,
    Unsupported,  // shouldn't happen!
}

export interface Shell {
    isWindows(): boolean;
    isUnix(): boolean;
    platform(): Platform;
    home(): string;
    combinePath(basePath: string, relativePath: string);
    fileUri(filePath): vscode.Uri;
    execOpts(): any;
    exec(cmd: string, stdin?: string): Promise<ShellResult>;
    execCore(cmd: string, opts: any, stdin?: string): Promise<ShellResult>;
    autoDockerEnvConfig(env: any);
}

export const shell: Shell = {
    isWindows: isWindows,
    isUnix: isUnix,
    platform: platform,
    home: home,
    combinePath: combinePath,
    fileUri: fileUri,
    execOpts: execOpts,
    exec: exec,
    execCore: execCore,
    autoDockerEnvConfig: autoDockerEnvConfig
};

const WINDOWS: string = 'win32';

export interface ShellResult {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}

export type ShellHandler = (code: number, stdout: string, stderr: string) => void;

function isWindows(): boolean {
    return (process.platform === WINDOWS);
}

function isUnix(): boolean {
    return !isWindows();
}

function platform(): Platform {
    switch (process.platform) {
        case 'win32': return Platform.Windows;
        case 'darwin': return Platform.MacOS;
        case 'linux': return Platform.Linux;
        default: return Platform.Unsupported;
    }
}

function home(): string {
    const homeVar = isWindows() ? 'USERPROFILE' : 'HOME';
    return process.env[homeVar];
}

function combinePath(basePath: string, relativePath: string) {
    let separator = '/';
    if (isWindows()) {
        relativePath = relativePath.replace(/\//g, '\\');
        separator = '\\';
    }
    return basePath + separator + relativePath;
}

function fileUri(filePath: string): vscode.Uri {
    if (isWindows()) {
        return vscode.Uri.parse('file:///' + filePath.replace(/\\/g, '/'));
    }
    return vscode.Uri.parse('file://' + filePath);
}

function execOpts(): any {
    let env = process.env;
    if (isWindows()) {
        env = Object.assign({}, env, { HOME: home() });
    }
    env = shellEnvironment(env);
    const opts = {
        cwd: vscode.workspace.rootPath,
        env: env,
        async: true
    };
    return opts;
}

async function exec(cmd: string, stdin?: string): Promise<ShellResult> {
    try {
        return await execCore(cmd, execOpts(), stdin);
    } catch (ex) {
        vscode.window.showErrorMessage(ex);
    }
}

function execCore(cmd: string, opts: any, stdin?: string): Promise<ShellResult> {
    return new Promise<ShellResult>((resolve, reject) => {
        let proc = shelljs.exec(cmd, opts, (code, stdout, stderr) => resolve({ code: code, stdout: stdout, stderr: stderr }));
        if (stdin) {
            proc.stdin.end(stdin);
        }
    });
}

export function shellEnvironment(baseEnvironment: any): any {
    let env = Object.assign({}, baseEnvironment);
    let pathVariable = pathVariableName(env);
    for (const tool of ['kubectl', 'helm', 'draft']) {
        const toolPath = vscode.workspace.getConfiguration('vs-kubernetes')[`vs-kubernetes.${tool}-path`];
        if (toolPath) {
            const toolDirectory = path.dirname(toolPath);
            const currentPath = env[pathVariable];
            if (autoDockerEnvConfig(env)) {

            } else {
                //TODO configure via extension configuration
            }
            env[pathVariable] = (currentPath ? `${currentPath}${pathEntrySeparator()}` : '') + toolDirectory;
        }
    }

    const kubeconfig: string = vscode.workspace.getConfiguration('vs-kubernetes')['vs-kubernetes.kubeconfig'];
    if (kubeconfig) {
        env['KUBECONFIG'] = kubeconfig;
    }

    return env;
}

//TODO async ?? and better error handling
export function autoDockerEnvConfig(env: any): boolean {
    //Auto detect only if DOCKER_HOST and DOCKER_CERT_PATH not defined
    if (!process.env['DOCKER_HOST'] && !process.env['DOCKER_CERT_PATH']) {
        let shellResult;
        let tryMinishift = false;

        //check if minikube or minishift exists
        if (shelljs.which('minikube')) {
            shellResult = shelljs.exec("minikube docker-env", { silent: true });
            if (shellResult.code !== 0 || shellResult.stderr) {
                tryMinishift = true;
            }
        } else {
            tryMinishift = true;
        }

        shellResult = null;

        if (tryMinishift) {
            if (shelljs.which('minishift')) {
                shellResult = shelljs.exec("minishift docker-env", { silent: true });
            } else {
                return false;
            }
        }

        if (shellResult.code === 0 && !shellResult.stderr) {
            const stdout = shellResult.stdout;
            let lines = stdout.split(/[\r\n]+/);
            //lines.shift();
            lines = lines.filter((l) => l.length > 0);
            const regexp: RegExp = new RegExp(/^export\s*([a-zA-Z0-9_]*)=(.*)$/);
            lines.map((line) => {
                let match = regexp.exec(line);
                if (match && match.length >= 2) {
                    const varName = match[1];
                    const varValue = match[2].replace(/"/gi, '');
                    console.log(varName + "=" + varValue);
                    process.env[varName] = varValue;
                } else {
                    console.log("No match for line :" + line);
                }
            });
        } else {
            //TODO more efficient
            console.log("Error Configuring Docker :" + shellResult.stderr);
            return false;
        }
    }
    return false;
}

function pathVariableName(env: any): string {
    if (isWindows()) {
        for (const v of Object.keys(env)) {
            if (v.toLowerCase() === "path") {
                return v;
            }
        }
    }
    return "PATH";
}

function pathEntrySeparator() {
    return isWindows() ? ';' : ':';
}
