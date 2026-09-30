import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import './App.css'

// 当前准备控制的 5 个旋转关节名称。
type JointName = 'joint1' | 'joint2' | 'joint3' | 'joint4' | 'joint5'

type JointConfig = {
  name: JointName
  label: string

  // 该关节直接控制哪个 link 的坐标系。
  childLink: string

  // 关节旋转轴，来自 nexarm.urdf。
  axis: [number, number, number]

  // 网页滑块使用角度制。
  minDegrees: number
  maxDegrees: number
}

// NexArm 关节配置。
// URDF 中 joint1～joint5 的范围约为 -2.09～2.09 弧度，
// 换算后约为 -120～120 度。
const JOINT_CONFIGS: JointConfig[] = [
  {
    name: 'joint1',
    label: '关节 1：底座旋转',
    childLink: 'link1',
    axis: [0, 0, -1],
    minDegrees: -120,
    maxDegrees: 120,
  },
  {
    name: 'joint2',
    label: '关节 2：大臂',
    childLink: 'link2',
    axis: [0, 1, 0],
    minDegrees: -120,
    maxDegrees: 120,
  },
  {
    name: 'joint3',
    label: '关节 3：小臂',
    childLink: 'link3',
    axis: [0, 1, 0],
    minDegrees: -120,
    maxDegrees: 15,
  },
  {
    name: 'joint4',
    label: '关节 4：腕部俯仰',
    childLink: 'link4',
    axis: [0, 1, 0],
    minDegrees: -49,
    maxDegrees: 120,
  },
  {
    name: 'joint5',
    label: '关节 5：腕部旋转',
    childLink: 'link5',
    axis: [0.99998, 0, -0.0060546],
    minDegrees: -120,
    maxDegrees: 120,
  },
]

const INITIAL_JOINT_ANGLES: Record<JointName, number> = {
  joint1: 0,
  joint2: 0,
  joint3: 0,
  joint4: 0,
  joint5: 0,
}

// NexArm 源码中的抓夹控制范围：-60° 为完全张开，30° 为闭合。
// 两个夹爪之间的最大开口约为 51 mm。
const GRIPPER_OPEN_DEGREES = -10
const GRIPPER_CLOSED_DEGREES = 30
const GRIPPER_INITIAL_DEGREES = 0
const GRIPPER_MAX_OPEN_MM = 51
const GRIPPER_BASE_AXIS: [number, number, number] = [
  0.99998,
  0,
  -0.0066507,
]

type GripperFrames = {
  base?: THREE.Group
  leftJaw?: THREE.Group
  rightJaw?: THREE.Group
  leftJawInitialPosition?: THREE.Vector3
  rightJawInitialPosition?: THREE.Vector3
}

// 将抓夹舵机角度换算为两个夹爪之间的开口宽度。
const gripperAngleToOpeningMm = (angleDegrees: number) => {
  const limitedDegrees = THREE.MathUtils.clamp(
    angleDegrees,
    GRIPPER_OPEN_DEGREES,
    GRIPPER_CLOSED_DEGREES,
  )

  const openingRatio =
    (GRIPPER_CLOSED_DEGREES - limitedDegrees) /
    (GRIPPER_CLOSED_DEGREES - GRIPPER_OPEN_DEGREES)

  return openingRatio * GRIPPER_MAX_OPEN_MM
}

function App() {
  const viewportRef = useRef<HTMLDivElement>(null)
  // 右上角的小画布专门显示安装在机械臂末端的相机视角。
  const cameraViewportRef = useRef<HTMLDivElement>(null)
  // cameraMonitorRef 指向整个相机窗口。
  const cameraMonitorRef = useRef<HTMLDivElement>(null)

  // cameraDragHandleRef 指向相机窗口顶部的标题栏。
  // 只有按住标题栏才能拖动窗口。
  const cameraDragHandleRef = useRef<HTMLDivElement>(null)


  // 保存 joint1～joint5 对应的 Three.js Group。
  // React 界面的滑块通过这里找到需要旋转的对象。
  const jointFramesRef = useRef<
    Partial<Record<JointName, THREE.Group>>
  >({})

  // 抓夹包含一个驱动连杆和两个相向移动的夹爪，因此单独保存。
  const gripperFramesRef = useRef<GripperFrames>({})

  // 保存滑块当前显示的角度，单位是度。
  const [jointAngles, setJointAngles] = useState<
    Record<JointName, number>
  >({ ...INITIAL_JOINT_ANGLES })
  const [gripperAngle, setGripperAngle] = useState(
    GRIPPER_INITIAL_DEGREES,
  )
  const [status, setStatus] = useState('正在准备 NexArm 模型...')
  const [statusType, setStatusType] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )

  useEffect(() => {
    const viewport = viewportRef.current
    const cameraViewport = cameraViewportRef.current
    const cameraMonitor = cameraMonitorRef.current
    const cameraDragHandle = cameraDragHandleRef.current

    if (
      !viewport ||
      !cameraViewport ||
      !cameraMonitor ||
      !cameraDragHandle
    ) {
      return
    }

    let disposed = false

    // 保存所有已经创建的模型资源。
    // 页面关闭时需要释放这些资源，避免显卡内存泄漏。
    const geometries: THREE.BufferGeometry[] = []
    const materials: THREE.MeshStandardMaterial[] = []

    // 创建场景
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x111827)

    // 创建相机
    const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 100)
    camera.position.set(0.3, 0.25, 0.3)

    // 创建机械臂上的仿真相机。
    // Three.js 相机默认朝本地 -Z 方向观察；NexArm 的 URDF 没有单独定义
    // camera_optical_frame，所以先把它旋转为朝 camera_link 的 +X 方向观察。
    const robotCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.005, 10)
    robotCamera.name = 'nexarm_robot_camera'
    robotCamera.position.set(0.005, 0, 0)
    robotCamera.rotation.set(0, -Math.PI / 2, 0)

    // 创建WebGL渲染器
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
    })

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    viewport.appendChild(renderer.domElement)

    // 相机小窗使用第二个渲染器，但和主画面共用同一个 Three.js 场景。
    // 因此它看到的关节运动、地面和以后加入的物体都与主画面一致。
    const cameraRenderer = new THREE.WebGLRenderer({
      antialias: true,
    })

    cameraRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    cameraRenderer.outputColorSpace = THREE.SRGBColorSpace
    cameraViewport.appendChild(cameraRenderer.domElement)

    // 当前正在拖动相机窗口的鼠标指针编号。
    // null 表示当前没有拖动。
    let monitorPointerId: number | null = null

    // 鼠标按下位置与窗口左上角之间的距离。
    // 使用这个距离可以防止拖动开始时窗口突然跳动。
    let monitorGrabOffsetX = 0
    let monitorGrabOffsetY = 0

    const onMonitorPointerDown = (event: PointerEvent) => {
      // 只允许鼠标左键拖动。
      if (event.button !== 0) {
        return
      }

      const monitorRect = cameraMonitor.getBoundingClientRect()

      monitorPointerId = event.pointerId

      // 记录鼠标按下位置距离窗口左上角有多远。
      monitorGrabOffsetX = event.clientX - monitorRect.left
      monitorGrabOffsetY = event.clientY - monitorRect.top

      // 捕获鼠标指针。
      // 即使拖动过程中鼠标离开标题栏，也可以继续拖动。
      cameraDragHandle.setPointerCapture(event.pointerId)

      cameraDragHandle.classList.add('is-dragging')

      // 防止拖动时浏览器选择标题文字。
      event.preventDefault()
    }

    const onMonitorPointerMove = (event: PointerEvent) => {
      // 如果不是当前正在拖动的指针，就不处理。
      if (monitorPointerId !== event.pointerId) {
        return
      }

      const viewportRect = viewport.getBoundingClientRect()
      const monitorRect = cameraMonitor.getBoundingClientRect()

      // 计算窗口可以移动到的最右侧和最下侧。
      const maximumLeft = Math.max(
        0,
        viewportRect.width - monitorRect.width,
      )

      const maximumTop = Math.max(
        0,
        viewportRect.height - monitorRect.height,
      )

      // 根据当前鼠标位置计算窗口的新位置。
      const requestedLeft =
        event.clientX -
        viewportRect.left -
        monitorGrabOffsetX

      const requestedTop =
        event.clientY -
        viewportRect.top -
        monitorGrabOffsetY

      // 限制窗口位置，防止窗口被拖出主画面。
      const limitedLeft = THREE.MathUtils.clamp(
        requestedLeft,
        0,
        maximumLeft,
      )

      const limitedTop = THREE.MathUtils.clamp(
        requestedTop,
        0,
        maximumTop,
      )

      cameraMonitor.style.left = `${limitedLeft}px`
      cameraMonitor.style.top = `${limitedTop}px`

      // 原来的CSS使用right: 16px定位。
      // 开始拖动后改为使用left定位，所以需要关闭right。
      cameraMonitor.style.right = 'auto'

      event.preventDefault()
    }

    const onMonitorPointerUp = (event: PointerEvent) => {
      if (monitorPointerId !== event.pointerId) {
        return
      }

      if (cameraDragHandle.hasPointerCapture(event.pointerId)) {
        cameraDragHandle.releasePointerCapture(event.pointerId)
      }

      monitorPointerId = null
      cameraDragHandle.classList.remove('is-dragging')
    }

    cameraDragHandle.addEventListener(
      'pointerdown',
      onMonitorPointerDown,
    )

    cameraDragHandle.addEventListener(
      'pointermove',
      onMonitorPointerMove,
    )

    cameraDragHandle.addEventListener(
      'pointerup',
      onMonitorPointerUp,
    )

    cameraDragHandle.addEventListener(
      'pointercancel',
      onMonitorPointerUp,
    )

    // 添加鼠标视角控制
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true

    // 添加环境光
    const hemisphereLight = new THREE.HemisphereLight(
      0xffffff,
      0x334155,
      2.2,
    )
    scene.add(hemisphereLight)

    // 添加主方向光
    const mainLight = new THREE.DirectionalLight(0xffffff, 3)
    mainLight.position.set(1, 1.5, 1)
    mainLight.castShadow = true
    scene.add(mainLight)

    // 添加辅助方向光
    const fillLight = new THREE.DirectionalLight(0x93c5fd, 1)
    fillLight.position.set(-1, 0.5, -1)
    scene.add(fillLight)

    // 创建地面网格
    const grid = new THREE.GridHelper(1, 20, 0x64748b, 0x334155)
    scene.add(grid)

    // 创建接收阴影的地面
    const floorMaterial = new THREE.ShadowMaterial({
      color: 0x000000,
      opacity: 0.25,
    })

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      floorMaterial,
    )

    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)

    // ROS使用Z轴向上，Three.js默认使用Y轴向上。
    // 整台机器人统一旋转，不修改STL内部坐标。
    const robotRoot = new THREE.Group()
    robotRoot.name = 'nexarm'
    robotRoot.rotation.x = -Math.PI / 2
    scene.add(robotRoot)

    // 显示坐标轴：X红色、Y绿色、Z蓝色
    const axes = new THREE.AxesHelper(0.1)
    robotRoot.add(axes)



    // 一个 LinkDefinition 代表机械臂的一个零件。
    type LinkDefinition = {
      name: string
      file: string
      parent: string | null
      xyz: [number, number, number]
      color: number
    }

    // 这些父子关系和坐标来自 NexArm 的 nexarm.urdf。
    // xyz 的单位是米，表示该零件关节原点相对于父零件的位置。
    const linkDefinitions: LinkDefinition[] = [
      {
        name: 'base_link',
        file: '/models/nexarm/base_link.STL',
        parent: null,
        xyz: [0, 0, 0],
        color: 0x94a3b8,
      },
      {
        name: 'link1',
        file: '/models/nexarm/link1.STL',
        parent: 'base_link',
        xyz: [0.00042383, 0, 0.071003],
        color: 0xe2e8f0,
      },
      {
        name: 'link2',
        file: '/models/nexarm/link2.STL',
        parent: 'link1',
        xyz: [-0.00041844, 0.03728, 0.039446],
        color: 0x94a3b8,
      },
      {
        name: 'link3',
        file: '/models/nexarm/link3.STL',
        parent: 'link2',
        xyz: [0.0348, -0.01893, 0.22535],
        color: 0xe2e8f0,
      },
      {
        name: 'link4',
        file: '/models/nexarm/link4.STL',
        parent: 'link3',
        xyz: [0.027316, 0, -0.14239],
        color: 0x94a3b8,
      },
      {
        name: 'camera_link',
        file: '/models/nexarm/camera_link.STL',
        parent: 'link4',
        xyz: [0.064555, -0.019407, 0.036497],
        color: 0x1e293b,
      },
      {
        name: 'link5',
        file: '/models/nexarm/link5.STL',
        parent: 'link4',
        xyz: [0.049832, -0.018351, -0.00031098],
        color: 0xe2e8f0,
      },
      {
        name: 'gripper_link',
        file: '/models/nexarm/gripper_link.STL',
        parent: 'link5',
        xyz: [0.035032, 0, -0.00022027],
        color: 0x64748b,
      },
      {
        name: 'gripper_base_link',
        file: '/models/nexarm/gripper_base_link.STL',
        parent: 'gripper_link',
        xyz: [0.0023084, 0, -0.000014336],
        color: 0x475569,
      },
      {
        name: 'right_jaw_link',
        file: '/models/nexarm/right_jaw_link.STL',
        parent: 'gripper_link',
        xyz: [0.0081154, -0.038561, -0.013453],
        color: 0xf59e0b,
      },
      {
        name: 'left_jaw_link',
        file: '/models/nexarm/left_jaw_link.STL',
        parent: 'gripper_link',
        xyz: [0.0091166, 0.038561, -0.01346],
        color: 0xf59e0b,
      },
    ]

    // STLLoader 负责读取 STL 文件。
    const loader = new STLLoader()

    // Map 用来根据零件名称找到对应的 Three.js Group。
    const linkFrames = new Map<string, THREE.Group>()

    const loadRobot = async () => {
      try {
        // 第一步：创建机械臂父子层级。
        //
        // 每个 Group 既代表零件坐标系，也代表这个零件的旋转中心。
        // 以后控制关节时，旋转对应的 Group 即可。
        for (const definition of linkDefinitions) {
          const linkFrame = new THREE.Group()

          linkFrame.name = `${definition.name}_frame`
          linkFrame.position.set(...definition.xyz)

          linkFrames.set(definition.name, linkFrame)
          // 找出当前 link 是不是 joint1～joint5 控制的零件。
          const jointConfig = JOINT_CONFIGS.find(
            (joint) => joint.childLink === definition.name,
          )

          // 如果是，就保存这个 Group，供滑块控制。
          if (jointConfig) {
            jointFramesRef.current[jointConfig.name] = linkFrame
          }

          // 抓夹不是普通旋转关节：驱动连杆旋转时，左右夹爪还要反向平移。
          if (definition.name === 'gripper_base_link') {
            gripperFramesRef.current.base = linkFrame
          } else if (definition.name === 'left_jaw_link') {
            gripperFramesRef.current.leftJaw = linkFrame
            gripperFramesRef.current.leftJawInitialPosition =
              linkFrame.position.clone()
          } else if (definition.name === 'right_jaw_link') {
            gripperFramesRef.current.rightJaw = linkFrame
            gripperFramesRef.current.rightJawInitialPosition =
              linkFrame.position.clone()
          }

          if (definition.parent === null) {
            // base_link 没有父零件，直接安装到 robotRoot。
            robotRoot.add(linkFrame)
          } else {
            const parentFrame = linkFrames.get(definition.parent)

            if (!parentFrame) {
              throw new Error(
                `找不到 ${definition.name} 的父零件 ${definition.parent}`,
              )
            }

            parentFrame.add(linkFrame)
          }

          // 把仿真相机安装在 camera_link 坐标系下。
          // camera_link 随 link4 和前面各级关节运动时，相机也会自动跟随。
          if (definition.name === 'camera_link') {
            linkFrame.add(robotCamera)
          }
        }

        // 第二步：逐个加载 STL，并安装到对应坐标系。
        for (let index = 0; index < linkDefinitions.length; index += 1) {
          const definition = linkDefinitions[index]

          setStatus(
            `正在加载 ${definition.name}：${index + 1}/${linkDefinitions.length}`,
          )

          const geometry = await loader.loadAsync(definition.file)

          // 如果页面已经关闭，立即释放刚加载的模型。
          if (disposed) {
            geometry.dispose()
            return
          }

          geometry.computeVertexNormals()

          const material = new THREE.MeshStandardMaterial({
            color: definition.color,
            roughness: 0.55,
            metalness: 0.15,
          })

          const mesh = new THREE.Mesh(geometry, material)

          mesh.name = definition.name
          mesh.castShadow = true
          mesh.receiveShadow = true

          const linkFrame = linkFrames.get(definition.name)

          if (!linkFrame) {
            geometry.dispose()
            material.dispose()
            throw new Error(`找不到 ${definition.name} 对应的坐标系`)
          }

          linkFrame.add(mesh)

          geometries.push(geometry)
          materials.push(material)
        }

        // 第三步：根据完整机械臂的尺寸调整相机。
        robotRoot.updateMatrixWorld(true)

        const boundingBox = new THREE.Box3().setFromObject(robotRoot)

        if (boundingBox.isEmpty()) {
          throw new Error('机械臂模型的包围盒为空')
        }

        const modelSize = boundingBox.getSize(new THREE.Vector3())
        const modelCenter = boundingBox.getCenter(new THREE.Vector3())

        const maxDimension = Math.max(
          modelSize.x,
          modelSize.y,
          modelSize.z,
          0.05,
        )

        const cameraDistance = maxDimension * 2.2

        camera.position.set(
          modelCenter.x + cameraDistance,
          modelCenter.y + cameraDistance * 0.8,
          modelCenter.z + cameraDistance,
        )

        camera.near = Math.max(maxDimension / 1000, 0.0001)
        camera.far = Math.max(maxDimension * 100, 10)
        camera.updateProjectionMatrix()

        controls.target.copy(modelCenter)
        controls.minDistance = maxDimension * 0.3
        controls.maxDistance = maxDimension * 20
        controls.update()

        // 将地面放在完整机械臂的最底部。
        floor.position.y = boundingBox.min.y - 0.001
        floor.scale.set(maxDimension * 8, maxDimension * 8, 1)

        grid.position.y = boundingBox.min.y
        grid.scale.setScalar(Math.max(maxDimension * 4, 0.5))

        if (!disposed) {
          setStatus(`NexArm ${linkDefinitions.length} 个部件加载完成`)
          setStatusType('ready')
        }
      } catch (error) {
        console.error('NexArm 模型加载失败：', error)

        if (!disposed) {
          const message =
            error instanceof Error ? error.message : '未知模型加载错误'

          setStatus(`模型加载失败：${message}`)
          setStatusType('error')
        }
      }
    }

    void loadRobot()
    const keepCameraMonitorInsideViewport = () => {
      // 没有拖动过时，继续使用CSS设置的默认右上角位置。
      if (cameraMonitor.style.right !== 'auto') {
        return
      }

      const viewportRect = viewport.getBoundingClientRect()
      const monitorRect = cameraMonitor.getBoundingClientRect()

      const currentLeft = monitorRect.left - viewportRect.left
      const currentTop = monitorRect.top - viewportRect.top

      const maximumLeft = Math.max(
        0,
        viewportRect.width - monitorRect.width,
      )

      const maximumTop = Math.max(
        0,
        viewportRect.height - monitorRect.height,
      )

      cameraMonitor.style.left = `${THREE.MathUtils.clamp(
        currentLeft,
        0,
        maximumLeft,
      )}px`

      cameraMonitor.style.top = `${THREE.MathUtils.clamp(
        currentTop,
        0,
        maximumTop,
      )}px`
    }

    // 根据窗口尺寸调整画布
    const resizeRenderer = () => {
      const width = viewport.clientWidth
      const height = viewport.clientHeight
      const cameraWidth = cameraViewport.clientWidth
      const cameraHeight = cameraViewport.clientHeight

      if (width > 0 && height > 0) {
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
      }

      if (cameraWidth > 0 && cameraHeight > 0) {
        cameraRenderer.setSize(cameraWidth, cameraHeight, false)
        robotCamera.aspect = cameraWidth / cameraHeight
        robotCamera.updateProjectionMatrix()
      }
    }

    keepCameraMonitorInsideViewport()

    const resizeObserver = new ResizeObserver(resizeRenderer)
    resizeObserver.observe(viewport)
    resizeObserver.observe(cameraViewport)
    resizeObserver.observe(cameraMonitor)
    resizeRenderer()

    // 持续渲染
    renderer.setAnimationLoop(() => {
      controls.update()
      renderer.render(scene, camera)
      cameraRenderer.render(scene, robotCamera)
    })

    // 页面卸载时释放资源
    return () => {
      disposed = true
      jointFramesRef.current = {}
      gripperFramesRef.current = {}

      resizeObserver.disconnect()
      renderer.setAnimationLoop(null)
      controls.dispose()

      cameraDragHandle.removeEventListener(
        'pointerdown',
        onMonitorPointerDown,
      )

      cameraDragHandle.removeEventListener(
        'pointermove',
        onMonitorPointerMove,
      )

      cameraDragHandle.removeEventListener(
        'pointerup',
        onMonitorPointerUp,
      )

      cameraDragHandle.removeEventListener(
        'pointercancel',
        onMonitorPointerUp,
      )

      geometries.forEach((geometry) => {
        geometry.dispose()
      })

      materials.forEach((material) => {
        material.dispose()
      })
      floor.geometry.dispose()
      floorMaterial.dispose()

      renderer.dispose()
      renderer.domElement.remove()
      cameraRenderer.dispose()
      cameraRenderer.domElement.remove()
    }
  }, [])

  // 修改一个关节角度。
  const changeJointAngle = (
    jointName: JointName,
    requestedDegrees: number,
  ) => {
    const config = JOINT_CONFIGS.find(
      (joint) => joint.name === jointName,
    )

    if (!config) {
      return
    }

    // 防止角度超过 URDF 关节范围。
    const limitedDegrees = THREE.MathUtils.clamp(
      requestedDegrees,
      config.minDegrees,
      config.maxDegrees,
    )

    // 更新 React 页面上显示的角度。
    setJointAngles((currentAngles) => ({
      ...currentAngles,
      [jointName]: limitedDegrees,
    }))

    // 找到这个关节对应的 Three.js Group。
    const jointFrame = jointFramesRef.current[jointName]

    if (!jointFrame) {
      return
    }

    // Three.js 的 setFromAxisAngle 要求旋转轴是单位向量。
    const axis = new THREE.Vector3(...config.axis).normalize()

    // 网页滑块使用度，Three.js 使用弧度，因此需要转换。
    const radians = THREE.MathUtils.degToRad(limitedDegrees)

    // 让 Group 围绕 URDF 指定的轴旋转。
    jointFrame.quaternion.setFromAxisAngle(axis, radians)
  }

  // 修改抓夹舵机角度，并同步驱动连杆与左右夹爪的位置。
  const changeGripperAngle = (requestedDegrees: number) => {
    const limitedDegrees = THREE.MathUtils.clamp(
      requestedDegrees,
      GRIPPER_OPEN_DEGREES,
      GRIPPER_CLOSED_DEGREES,
    )

    setGripperAngle(limitedDegrees)

    const frames = gripperFramesRef.current
    const radians = THREE.MathUtils.degToRad(limitedDegrees)

    // gripper_base_link 表示抓夹舵机带动的旋转连杆。
    if (frames.base) {
      const axis = new THREE.Vector3(...GRIPPER_BASE_AXIS).normalize()
      frames.base.quaternion.setFromAxisAngle(axis, radians)
    }

    // STL 的初始位置对应 0°。先计算目标开口与 0° 开口的差值，
    // 再把总差值平均分给左右两个夹爪。
    const initialOpeningMm = gripperAngleToOpeningMm(
      GRIPPER_INITIAL_DEGREES,
    )
    const targetOpeningMm = gripperAngleToOpeningMm(limitedDegrees)
    const eachJawOffsetMeters =
      (targetOpeningMm - initialOpeningMm) / 2 / 1000

    if (frames.rightJaw && frames.rightJawInitialPosition) {
      frames.rightJaw.position.copy(frames.rightJawInitialPosition)
      frames.rightJaw.position.y -= eachJawOffsetMeters
    }

    if (frames.leftJaw && frames.leftJawInitialPosition) {
      frames.leftJaw.position.copy(frames.leftJawInitialPosition)
      frames.leftJaw.position.y += eachJawOffsetMeters
    }
  }

  // 将所有旋转关节和抓夹恢复到 0 度。
  const resetJoints = () => {
    setJointAngles({ ...INITIAL_JOINT_ANGLES })

    JOINT_CONFIGS.forEach((joint) => {
      const jointFrame = jointFramesRef.current[joint.name]

      if (jointFrame) {
        jointFrame.quaternion.identity()
      }
    })

    changeGripperAngle(GRIPPER_INITIAL_DEGREES)
  }

  return (
    <main className="viewer-page">
      <header className="viewer-header">
        <div>
          <h1>NexArm 虚拟仿真</h1>
          <p>xccc</p>
        </div>

        <span className={`status status-${statusType}`}>
          {status}
        </span>
      </header>

      <div className="viewer-content">
        <section ref={viewportRef} className="viewport">
          <div
            ref={cameraMonitorRef}
            className="camera-monitor"
          >
            <div
              ref={cameraDragHandleRef}
              className="camera-monitor-header"
              title="按住鼠标左键拖动窗口"
            >
              <span>末端相机画面</span>
              <span className="camera-monitor-state">仿真</span>
            </div>

            <div
              ref={cameraViewportRef}
              className="camera-preview-canvas"
            />
          </div>

          <div className="operation-help">
            <span>左键：旋转视角</span>
            <span>右键：平移视角</span>
            <span>滚轮：缩放</span>
          </div>
        </section>

        <aside className="joint-panel">
          <div className="joint-panel-header">
            <div>
              <h2>关节控制</h2>
              <p>当前仅控制浏览器中的三维模型</p>
            </div>

            <button
              type="button"
              className="reset-button"
              onClick={resetJoints}
              disabled={statusType !== 'ready'}
            >
              复位
            </button>
          </div>

          <div className="joint-list">
            {JOINT_CONFIGS.map((joint) => (
              <div className="joint-control" key={joint.name}>
                <div className="joint-control-title">
                  <label htmlFor={`slider-${joint.name}`}>
                    {joint.label}
                  </label>

                  <span>{jointAngles[joint.name]}°</span>
                </div>

                <input
                  id={`slider-${joint.name}`}
                  type="range"
                  min={joint.minDegrees}
                  max={joint.maxDegrees}
                  step={1}
                  value={jointAngles[joint.name]}
                  disabled={statusType !== 'ready'}
                  onChange={(event) => {
                    changeJointAngle(
                      joint.name,
                      Number(event.currentTarget.value),
                    )
                  }}
                />

                <div className="joint-range">
                  <span>{joint.minDegrees}°</span>
                  <span>0°</span>
                  <span>{joint.maxDegrees}°</span>
                </div>
              </div>
            ))}

            <div className="joint-control">
              <div className="joint-control-title">
                <label htmlFor="slider-gripper">
                  抓夹：开合
                </label>

                <span className="gripper-value">
                  {gripperAngle}° /{' '}
                  {gripperAngleToOpeningMm(gripperAngle).toFixed(1)} mm
                </span>
              </div>

              <input
                id="slider-gripper"
                type="range"
                min={GRIPPER_OPEN_DEGREES}
                max={GRIPPER_CLOSED_DEGREES}
                step={1}
                value={gripperAngle}
                disabled={statusType !== 'ready'}
                onChange={(event) => {
                  changeGripperAngle(
                    Number(event.currentTarget.value),
                  )
                }}
              />

              <div className="joint-range">
                <span>张开 -60°</span>
                <span>0°</span>
                <span>闭合 30°</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}

export default App
