import os

base_dir = '/home/pablo/Desarollo/Agentes/kleiber-t014'
dialog_path = os.path.join(base_dir, 'packages/renderer/src/components/Dialogs/NewSessionDialog.tsx')

with open(dialog_path, 'r') as f:
    dialog = f.read()

dialog = dialog.replace(
'''  const [yolo, setYolo] = useState(projectYoloDefault);
  const [isSubmitting, setIsSubmitting] = useState(false);''',
'''  const [yolo, setYolo] = useState(projectYoloDefault);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);''')

dialog = dialog.replace(
'''  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    setIsSubmitting(true);''',
'''  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    setIsSubmitting(true);
    setError(null);''')

dialog = dialog.replace(
'''    } catch (err) {
      console.error('Failed to create session', err);
    } finally {''',
'''    } catch (err: any) {
      console.error('Failed to create session', err);
      setError(err.message || 'Failed to create session');
    } finally {''')

dialog = dialog.replace(
'''          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-medium text-[#FAFAFA]">
              New Session
            </Dialog.Title>
            <Dialog.Close className="text-[#A1A1AA] hover:text-[#FAFAFA] rounded-sm opacity-70 hover:opacity-100 transition-opacity">
              <X size={20} />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">''',
'''          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-medium text-[#FAFAFA]">
              New Session
            </Dialog.Title>
            <Dialog.Close className="text-[#A1A1AA] hover:text-[#FAFAFA] rounded-sm opacity-70 hover:opacity-100 transition-opacity">
              <X size={20} />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && <div className="text-red-500 text-sm bg-red-500/10 p-2 rounded">{error}</div>}''')

with open(dialog_path, 'w') as f:
    f.write(dialog)

print("Dialog updated")
