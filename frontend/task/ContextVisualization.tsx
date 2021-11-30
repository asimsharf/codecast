import React, {useEffect} from "react";
import {quickAlgoLibraries} from "./libs/quickalgo_librairies";
import {useAppSelector} from "../hooks";
import {useResizeDetector} from "react-resize-detector";
import {TaskTestsSelector} from "./TaskTestsSelector";

export function ContextVisualization() {
    const Visualization = quickAlgoLibraries.getVisualization();
    const currentTask = useAppSelector(state => state.task.currentTask);
    const currentLevel = useAppSelector(state => state.task.currentLevel);
    const taskLoaded = useAppSelector(state => state.task.loaded);
    const {width, height, ref} = useResizeDetector();
    const zoomLevel = useAppSelector(state => state.layout.zoomLevel);

    useEffect(() => {
        quickAlgoLibraries.redrawDisplay();
    }, [taskLoaded]);

    useEffect(() => {
        const context = quickAlgoLibraries.getContext(null, 'main');
        if (context) {
            context.updateScale();
        }
    }, [width, height]);

    let testsSelectorEnabled = false;
    if (currentTask && currentLevel) {
        const levelData = currentTask.data[currentLevel];
        testsSelectorEnabled = 1 < levelData.length;
    }

    return (
        <div className="context-visualization">
            <div className="task-visualization-container">
                <div className="task-visualization" ref={ref} style={{fontSize: `${zoomLevel}rem`}}>
                    {currentTask && currentTask.gridInfos && currentTask.gridInfos.images &&
                        currentTask.gridInfos.images.map((module, key) =>
                            <img key={key} src={module.default} style={{display: 'none'}}/>
                        )
                    }
                    {Visualization ? <Visualization/> : <div id="grid"/>}
                </div>
            </div>

            {testsSelectorEnabled && <TaskTestsSelector/>}
        </div>
    );
}
