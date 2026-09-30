from pathlib import Path

import mujoco

SCENE_PATH = Path(__file__).resolve().parents[1] / "models" / "minimal_scene.xml"
SIMULATION_SECONDS = 2.0
EXPECTED_BLOCK_Z = 0.435
HEIGHT_TOLERANCE = 0.01


def run_simulation() -> None:
    model = mujoco.MjModel.from_xml_path(str(SCENE_PATH))
    data = mujoco.MjData(model)

    mujoco.mj_forward(model, data)
    block = data.body("red_block")
    initial_z = float(block.xpos[2])

    while data.time < SIMULATION_SECONDS:
        mujoco.mj_step(model, data)

    final_z = float(block.xpos[2])
    passed = abs(final_z - EXPECTED_BLOCK_Z) <= HEIGHT_TOLERANCE

    print(f"scene={SCENE_PATH}")
    print(f"initial_z={initial_z:.4f} m")
    print(f"final_z={final_z:.4f} m")
    print(f"contacts={data.ncon}")
    print(f"simulation_time={data.time:.3f} s")
    print(f"RESULT={'PASS' if passed else 'FAIL'}")


if __name__ == "__main__":
    run_simulation()