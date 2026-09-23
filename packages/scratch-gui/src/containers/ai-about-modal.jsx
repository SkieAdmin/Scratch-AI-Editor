import {connect} from 'react-redux';

import AiAboutModalComponent from '../components/ai-about-modal/ai-about-modal.jsx';
import {closeAiAboutModal} from '../reducers/modals';

const mapStateToProps = state => ({
    isRtl: state.locales.isRtl
});

const mapDispatchToProps = dispatch => ({
    onRequestClose: () => dispatch(closeAiAboutModal())
});

export default connect(mapStateToProps, mapDispatchToProps)(AiAboutModalComponent);
