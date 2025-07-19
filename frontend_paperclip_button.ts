import {
    ReadFileContent
} from '../wailsjs/go/main/App';
import {
    artifacts
} from '../wailsjs/go/models';
import * as runtime from '../wailsjs/runtime';


const uploadArtifactButton = document.getElementById('uploadArtifactButton');
const fileUploadInput = document.getElementById('fileUploadInput');

uploadArtifactButton.addEventListener('click', () => {
    runtime.dialog.OpenFile({
        title: "Select files",
        filters: [{
                DisplayName: "Images & Videos",
                Pattern: "*.png;*.jpg;*.jpeg;*.gif;*.mp4;*.mov;*.webm"
            },
            {
                DisplayName: "Images",
                Pattern: "*.png;*.jpg;*.jpeg;*.gif"
            },
            {
                DisplayName: "Videos",
                Pattern: "*.mp4;*.mov;*.webm"
            },
        ],
        canSelectMultiple: true,
    }).then(files => {
        if (files) {
            files.forEach(file => {
                ReadFileContent(file).then(content => {
                    const fileExtension = file.split('.').pop().toLowerCase();
                    let artifactType;
                    if (['png', 'jpg', 'jpeg', 'gif'].includes(fileExtension)) {
                        artifactType = artifacts.ArtifactType.IMAGE;
                    } else if (['mp4', 'mov', 'webm'].includes(fileExtension)) {
                        artifactType = artifacts.ArtifactType.VIDEO;
                    }

                    if (artifactType) {
                        const metadata = {
                            fileName: file.split('/').pop(),
                            size: content.length
                        };
                        window.go.main.App.ArtifactService.AddArtifact(artifactType, content, metadata, true);
                    }
                });
            });
        }
    });
});
