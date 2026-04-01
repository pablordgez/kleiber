import os
base_dir = '/home/pablo/Desarollo/Agentes/kleiber-t014'

handlers_path = os.path.join(base_dir, 'packages/main/src/ipc/handlers.ts')
with open(handlers_path, 'r') as f:
    handlers = f.read()

handlers = handlers.replace(
'''          role: data.role ?? null,
          requestedYolo: data.yolo,
          name: data.name,''',
'''          role: data.role ?? null,
          ...(data.yolo !== undefined ? { requestedYolo: data.yolo } : {}),
          name: data.name,''')

with open(handlers_path, 'w') as f:
    f.write(handlers)

print("Yolo fixed")
