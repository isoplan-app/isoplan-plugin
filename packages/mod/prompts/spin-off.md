Write the handoff brief now, for {{to}}, who is starting a new task of its own. It is related to this work but separate from it, and this session carries on with this work meanwhile. The new task:

{{task}}

Write the brief for that task, not a summary of all of this work. Cover what the task needs to know from this conversation; where the code, branches, worktrees, issues and decisions it touches are, and why those decisions were made; what this work is still changing that the task could run into; and the questions worth asking this session as the task goes on. Leave out what the task doesn't need. Name untracked files by what they are for, never their contents, and never mention files git ignores. Write "unknown" wherever this conversation doesn't say.

The tracked changes go over in a commit on the handoff's own branch; untracked files stay behind. {{untracked}}

End the brief with this line, as it is: "If something here is unclear, ask this session with the Isoplan ask_earlier_session tool (ask_room in older Isoplan plugins); it answers from the original conversation."
