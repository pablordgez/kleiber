export const IPC_CHANNELS = {
  projects: {
    list: "projects:list",
    create: "projects:create",
    pickDirectory: "projects:pick-directory",
    remove: "projects:remove",
    update: "projects:update",
  },
  sessions: {
    list: "sessions:list",
    create: "sessions:create",
    rename: "sessions:rename",
    send: "sessions:send",
    read: "sessions:read",
    kill: "sessions:kill",
    delete: "sessions:delete",
    updated: "sessions:updated",
    removed: "sessions:removed",
  },
  settings: {
    get: "settings:get",
    update: "settings:update",
  },
  remoteApiCredentials: {
    get: "remote-api-credentials:get",
    update: "remote-api-credentials:update",
    clear: "remote-api-credentials:clear",
  },
  pack: {
    status: "pack:status",
    detectCli: "pack:detect-cli",
    install: "pack:install",
    roles: "pack:roles",
  },
  terminals: {
    resize: "terminals:resize",
    output: "terminals:output",
    exit: "terminals:exit",
  },
  shortcuts: {
    newProject: "shortcut:new-project",
    newSession: "shortcut:new-session",
    newSubSession: "shortcut:new-sub-session",
    killSession: "shortcut:kill-session",
    openSettings: "shortcut:open-settings",
  },
} as const;

type ChannelGroup = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
export type IpcChannel = ChannelGroup[keyof ChannelGroup];
