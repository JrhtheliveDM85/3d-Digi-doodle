# How to install and use Clay Blocks

Short sentences. One job at a time.

You need:

- A computer with **Python 3** (the usual install from [python.org](https://www.python.org/)).
- **Chrome** or **Edge**.

You do not need an account. You do not need to run `npm`.

## Run it in three steps

1. Open the Clay Blocks folder. (If you have a zip, unzip it first. Keep all the files together.)
2. Start the server.
   - **Windows:** double-click **Start Clay Blocks**.
   - **Mac or Linux:** double-click **start.sh**. If that does not start, open Terminal in this folder and run:

     ```
     python3 serve.py
     ```

3. Open **http://127.0.0.1:8000** in Chrome or Edge.

Leave that window open while you work. Press Ctrl+C in the terminal when you want to stop the server.

The page must be opened from that address. Opening `index.html` by double-click will not work. Browsers block the offline app and the 3D code on a `file://` page.

## Install it so it works offline

Do this once, while the page is open in Chrome or Edge.

1. Look in the address bar for an install icon.
   - In Chrome it is a small screen with a down arrow.
   - In Edge it can say **App available**.
2. Press it, then press **Install**.
3. Open **Clay Blocks** from your apps list, or from the Start menu. You can close the server window after that.
4. Turn the internet off, then open Clay Blocks again.

Your models stay on this computer. They are not sent to a website.

If you do not see the install icon, open the browser menu and look for **Install Clay Blocks**, **Apps**, or **Install page as app**.

The first open has to happen while the server is running, so the app can save its files. Later opens can be offline.

## The big buttons

The six buttons along the bottom each do one job. The blue banner tells you which one is on. You do not have to remember.

| Button | What it does |
| --- | --- |
| Shapes | Add a box, a cylinder, a ball, a cone, or a ramp. It drops onto the plate. |
| Move | Drag a shape. It snaps onto the plate, or onto the shape under it. |
| Sculpt | Shape the clay. This turns on after **Make it clay**. |
| Undo | Go back one step. Newer pictures stay in the row. Nothing is thrown away. |
| Save | Save a copy of the model on this computer (a `.clayblocks.json` file). |
| Print | Open the print check, then save an STL or a 3MF file. |

Other buttons:

| Button | What it does |
| --- | --- |
| Make it clay | Join the solid shapes and cut the holes. Then you can sculpt. |
| Help | Short cards. Press **Read** and the card is spoken. |
| Settings | Voice, reading font, contrast, starter models, and scan import. |
| Put in the bin | Asks first, then removes the shape you selected. |
| Fix it for me | Only on the print card. It makes the model smaller, or sits it on the plate. |
| Where was I? | Shows when you come back. **Continue** keeps your model. **Start fresh** clears it. |

## Shapes, holes, and clay

1. Press **Shapes**, then press a shape.
2. The card under the shapes is the one you selected.
   - Type a size in millimetres, or press **Small**, **Medium**, or **Big**.
   - **This is a hole** marks that shape as a cutter. It looks like a wireframe.
3. Press **Move** and drag. Drop a shape on another shape to stack it.
4. Press **Make it clay** when the stack looks right.

Sculpt has three brushes: **Pull**, **Push**, and **Smooth**. One slider sets the size. Drag on the model.

Your versions sit in a row of pictures. Press a picture to go there. Older and newer pictures both stay.

Clay Blocks saves by itself after each change. You can also press **Save** to keep a file you can put somewhere else.

## Settings that help reading

- **Voice** speaks the button you press. You can turn it off, or change the speed. If the computer has no voice, the words stay on the screen.
- **Reading font** switches to Atkinson Hyperlegible. The font file is in the folder, so it works offline.
- **Contrast** switches to black text, black lines, and a white page.

Every main control has an icon, a word, and a spoken label.

## Import a scan

In **Settings**, press **Choose a file** and pick an STL or an OBJ.

Then choose:

- **A solid print** — add it as a shape.
- **A hole the shape fits into** — use it as a cutter.
- **Cancel** — do nothing.

Then press **Make it clay** if you want it joined with the rest.

## Print check

Press **Print**.

Read each line. The mark and the words say the same thing. Colour is only a helper.

- A tick means that one check passed.
- **Fix it for me** shows up only when Clay Blocks can sit the model on the plate, or make it smaller so it fits the Bambu Lab X2D main space (256 by 256 by 260 mm).
- **Make it clay** shows up when the shapes are still separate.
- A note about the skin is a simple check for open edges. It is not a promise that the skin is fully closed. Clay Blocks cannot close those gaps for you. There is no **Fix it for me** on that line.

Dual-nozzle printing on the X2D uses a smaller space than the main nozzle. The check uses the main space.

## Save a file for the printer

On the print card:

- **Save 3MF** — a 3MF file, in millimetres.
- **Save STL** — a binary STL file, in millimetres.

In Chrome or Edge you can pick the folder. In other browsers the file downloads.

Open that file in your printer app (for example Bambu Studio). Clay Blocks does not send it to the printer by itself.

## Starter models

In **Settings** you can start from a jar-opener grip, a big spoon handle, a pet bowl stand, or a small ramp. Change them however you like.

## If something is wrong

- The page is blank, or the install icon never appears: use Chrome or Edge, and use the `http://127.0.0.1:8000` address from step 3. Do not open the HTML file directly.
- “Python 3 was not found”: install Python 3, then double-click the starter again.
- “Port 8000 is already in use”: you already have Clay Blocks running. Use that window, or close it and start again.
- The model looks wrong after **Make it clay**: press **Undo**, move the shapes so they touch, and try again.
- Voice is quiet: some computers have no voice. The words on the buttons still work. You can also turn voice off in Settings.
