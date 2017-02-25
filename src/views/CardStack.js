/* @flow */

import React, { PropTypes, Component } from 'react';
import {
  StyleSheet,
  NativeModules,
  Platform,
  View,
  UIManager,
} from 'react-native';
import invariant from 'invariant';
import _ from 'lodash';

import Transitioner from './Transitioner';
import Card from './Card';
import CardStackStyleInterpolator from './CardStackStyleInterpolator';
import CardStackPanResponder from './CardStackPanResponder';
import Header from './Header';
import NavigationPropTypes from '../PropTypes';
import NavigationActions from '../NavigationActions';
import addNavigationHelpers from '../addNavigationHelpers';
import SceneView from './SceneView';

import type {
  NavigationAction,
  NavigationScreenProp,
  NavigationScene,
  NavigationSceneRenderer,
  NavigationSceneRendererProps,
  NavigationTransitionProps,
  NavigationRouter,
  Style,
} from '../TypeDefinition';

import type {
  HeaderMode,
} from './Header';

import type { TransitionConfig } from './TransitionConfigs';

import TransitionConfigs from './TransitionConfigs';

import TransitionItems from './Transition/TransitionItems';

const NativeAnimatedModule = NativeModules && NativeModules.NativeAnimatedModule;

type Props = {
  screenProps?: {};
  headerMode: HeaderMode,
  headerComponent?: ReactClass<*>,
  mode: 'card' | 'modal',
  navigation: NavigationScreenProp<*, NavigationAction>,
  router: NavigationRouter,
  cardStyle?: Style,
  onTransitionStart?: () => void,
  onTransitionEnd?: () => void,
  style: Style,
  gestureResponseDistance?: ?number,
  /**
   * Optional custom animation when transitioning between screens.
   */
  transitionConfig?: () => TransitionConfig,
};

type DefaultProps = {
  mode: 'card' | 'modal',
  headerComponent: ReactClass<*>,
};

type State = {
  transitionItems: TransitionItems,
  itemsToMeasure: Array<TransitionItem>,
};

class CardStack extends Component<DefaultProps, Props, void> {
  _render: NavigationSceneRenderer;
  _renderScene: NavigationSceneRenderer;
  _childNavigationProps: {
    [key: string]: NavigationScreenProp<*, NavigationAction>
  } = {};
  state: State;

  static Card = Card;
  static Header = Header;

  static propTypes = {
    /**
     * Custom style applied to the card.
     */
    cardStyle: PropTypes.any,

    /**
     * Style of the stack header. `float` means the header persists and is shared
     * for all screens. When set to `screen`, each header is rendered within the
     * card, and will animate in together.
     *
     * The default for `modal` mode is `screen`, and the default for `card` mode
     * is `screen` on Android and `float` on iOS.
     */
    headerMode: PropTypes.oneOf(['float', 'screen', 'none']),

    /**
     * Custom React component to be used as a header
     */
    headerComponent: PropTypes.func,

    /**
     * Style of the cards movement. Value could be `card` or `modal`.
     * Default value is `card`.
     */
    mode: PropTypes.oneOf(['card', 'modal']),

    /**
     * The distance from the edge of the card which gesture response can start
     * for. Default value is `30`.
     */
    gestureResponseDistance: PropTypes.number,

    /**
     * Optional custom animation when transitioning between screens.
     */
    transitionConfig: PropTypes.func,

    /**
     * The navigation prop, including the state and the dispatcher for the back
     * action. The dispatcher must handle the back action
     * ({ type: NavigationActions.BACK }), and the navigation state has this shape:
     *
     * ```js
     * const navigationState = {
     *   index: 0, // the index of the selected route.
     *   routes: [ // A list of routes.
     *     {key: 'page 1'}, // The 1st route.
     *     {key: 'page 2'}, // The second route.
     *   ],
     * };
     * ```
     */
    navigation: PropTypes.shape({
      state: NavigationPropTypes.navigationState.isRequired,
      dispatch: PropTypes.func.isRequired,
    }).isRequired,

    /**
     * Custom style applied to the cards stack.
     */
    style: View.propTypes.style,
  };

  static childContextTypes = {
    registerTransitionItem: React.PropTypes.func,
    unregisterTransitionItem: React.PropTypes.func,
  }

  static defaultProps: DefaultProps = {
    mode: 'card',
    headerComponent: Header,
  };

  constructor(props: Props, context) {
    super(props, context);
    this.state = {
      transitionItems: new TransitionItems(),
      itemsToMeasure: null,
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    if (this.props !== nextProps) {
      return true;
    } else {
      return nextState.itemsToMeasure && nextState.itemsToMeasure.length === 0;
    }
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.navigation !== this.props.navigation) {
      this.setState({
        ...this.state,
        itemsToMeasure: [...this.state.transitionItems.items()],
      });
    }
  }

  getChildContext() {
    const self = this;
    return {
      registerTransitionItem(item: TransitionItem) {
        // if (item.nativeHandle===7) console.log('==> registering', item.toString());
        self.setState((prevState: State) => ({
          transitionItems: prevState.transitionItems.add(item),
        }));

        // const {name, containerRouteName} = TransitionItem;
        // const matchingItem = self.state.TransitionItems.findMatchByName(name, containerRouteName);
        // // schedule to measure (on layout) if another Item with the same name is mounted
        // if (matchingItem) {
        //   self.setState((prevState: State) => ({
        //     TransitionItems: prevState.TransitionItems,
        //     itemsToMeasure: [...prevState.itemsToMeasure, TransitionItem, matchingItem]
        //   }));
        // }
      },
      unregisterTransitionItem(id: string, routeName: string) {
        // console.log('==> unregistering', id, routeName);
        self.setState((prevState: State) => ({
          transitionItems: prevState.transitionItems.remove(id, routeName),
          itemsToMeasure: prevState.itemsToMeasure && prevState.itemsToMeasure.filter(i => i.id !== id || i.routeName !== routeName),
        }));
      },
    };
  }

  componentWillMount() {
    this._render = this._render.bind(this);
    this._renderScene = this._renderScene.bind(this);
  }

  render() {
    return (
      <Transitioner
        configureTransition={this._configureTransition}
        navigation={this.props.navigation}
        render={this._render}
        style={this.props.style}
        onTransitionStart={this.props.onTransitionStart}
        onTransitionEnd={this.props.onTransitionEnd}
      />
    );
  }

  _configureTransition = (
    // props for the new screen
    transitionProps: NavigationTransitionProps,
    // props for the old screen
    prevTransitionProps: NavigationTransitionProps
  ) => {
    const isModal = this.props.mode === 'modal';
    // Copy the object so we can assign useNativeDriver below
    // (avoid Flow error, transitionSpec is of type NavigationTransitionSpec).
    const transitionSpec = {
      ...this._getTransitionConfig(
        transitionProps,
        prevTransitionProps
      ).transitionSpec,
    };
    if (
       !!NativeAnimatedModule
       // Native animation support also depends on the transforms used:
       && CardStackStyleInterpolator.canUseNativeDriver(isModal)
    ) {
      // Internal undocumented prop
      transitionSpec.useNativeDriver = true;
    }
    return transitionSpec;
  }

  _renderHeader(
    transitionProps: NavigationTransitionProps,
    headerMode: HeaderMode
  ): ?React.Element<*> {
    const headerConfig = this.props.router.getScreenConfig(
      transitionProps.navigation,
      'header'
    ) || {};

    return (
      <this.props.headerComponent
        {...transitionProps}
        router={this.props.router}
        style={headerConfig.style}
        mode={headerMode}
        onNavigateBack={() => this.props.navigation.goBack(null)}
        renderLeftComponent={(props: NavigationTransitionProps) => {
          const header = this.props.router.getScreenConfig(props.navigation, 'header') || {};
          return header.left;
        }}
        renderRightComponent={(props: NavigationTransitionProps) => {
          const header = this.props.router.getScreenConfig(props.navigation, 'header') || {};
          return header.right;
        }}
        renderTitleComponent={(props: NavigationTransitionProps) => {
          const header = this.props.router.getScreenConfig(props.navigation, 'header') || {};
          // When we return 'undefined' from 'renderXComponent', header treats them as not
          // specified and default 'renderXComponent' functions are used. In case of 'title',
          // we return 'undefined' in case of 'string' too because the default 'renderTitle'
          // function in header handles them.
          if (typeof header.title === 'string') {
            return undefined;
          }
          return header.title;
        }}
      />
    );
  }

  _hideTransitionViewUntilDone(transitionProps, onFromRoute: boolean) {
    const {progress} = transitionProps;
    const opacity = (onFromRoute
      ? progress.interpolate({
          inputRange: [0, 0.01, 1],
          outputRange: [1, 0, 0],
        })
      : progress.interpolate({
          inputRange: [0, 0.99, 1],
          outputRange: [0, 0, 1],
        })
    );
    return { opacity };
  }

  _replaceFromToInStyleMap(styleMap, routeName: string, prevRouteName: ?string) {
    return {
      // ...styleMap,
      [prevRouteName || '$from']: styleMap.from, //TODO what should we do if prevRouteName === null?
      [routeName]: styleMap.to,
    }
  }

  _getTransition(routeName: string, prevRouteName: string) {
    const transitions = this.props.transitionConfigs.filter(c => (
      (c.from === prevRouteName || c.from === '*') &&
      (c.to === routeName || c.to === '*')));
    invariant(transitions.length <= 1, `More than one transitions found from "${prevRouteName}" to "${routeName}".`);
    return transitions[0];
  }

  _createTransitionStyleMaps(
    props: NavigationTransitionProps,
    prevTransitionProps:NavigationTransitionProps) {
    const routeName = props && props.scene.route.routeName;
    const prevRouteName = prevTransitionProps && prevTransitionProps.scene.route.routeName;

    const transition = this._getTransition(routeName, prevRouteName);
    if (!transition) {
      return {
        inPlace: {},
        clones: {},
      }
    }

    const isRoute = route => item => item.routeName === route;
    const filterPass = item => transition && (!!!transition.filter || transition.filter(item.id));
    const shouldClone = item => transition && typeof transition.shouldClone === 'function' && transition.shouldClone(item, prevRouteName, routeName);

    const filteredItems = this.state.transitionItems.items().filter(filterPass);
    const inPlaceItems = filteredItems.filter(i => !shouldClone(i));
    const toCloneItems = filteredItems.filter(shouldClone);

    const fromItemsInPlace = inPlaceItems.filter(isRoute(prevRouteName));
    const toItemsInPlace = inPlaceItems.filter(isRoute(routeName));
    const fromItemsClone = toCloneItems.filter(isRoute(prevRouteName));
    const toItemsClone = toCloneItems.filter(isRoute(routeName));

    const hideUntilDone = (items, onFromRoute: boolean) => items.reduce((result, item) => {
      result[item.id] = this._hideTransitionViewUntilDone(transitionProps, onFromRoute);
      return result;
    }, {}); 

    // in place items
    let inPlaceStyleMap = {
      ...transition.createAnimatedStyleMap && transition.createAnimatedStyleMap(fromItemsInPlace, toItemsInPlace, props),
      ...hideUntilDone(fromItemsClone, true),
      ...hideUntilDone(toItemsClone, false),
    };
    inPlaceStyleMap = this._replaceFromToInStyleMap(inPlaceStyleMap, routeName, prevRouteName);

    // clones
    let cloneStyleMap = transition.createAnimatedStyleMapForClones && transition.createAnimatedStyleMapForClones(fromItemsClone, toItemsClone, props);
    cloneStyleMap = cloneStyleMap && this._replaceFromToInStyleMap(cloneStyleMap, routeName, prevRouteName);
    
    return {
      inPlace: inPlaceStyleMap,
      clones: cloneStyleMap,
      toCloneItems, // TODO this should be put somewhere else
    };
  }

  _renderOverlay(toCloneItems: Array<TransitionItem>, styleMap) {
    // TODO what if an item is the parent of another item?
    const clones = toCloneItems.map(item => {
      const animatedStyle = styleMap[item.routeName] && styleMap[item.routeName][item.id];
      return React.cloneElement(item.reactElement, {
        style: [item.reactElement.props.style, styles.clonedItem, animatedStyle],
      }, []);
    });
    return (
      <View style={styles.overlay} pointerEvents="none">
        { clones }
      </View>
    );
  }

  _render(
      props: NavigationTransitionProps, 
      prevTransitionProps:NavigationTransitionProps): React.Element<*> {
    let floatingHeader = null;
    const headerMode = this._getHeaderMode();
    if (headerMode === 'float') {
      floatingHeader = this._renderHeader(props, headerMode);
    }

    const styleMaps = this._createTransitionStyleMaps(props, prevTransitionProps);

    const overlay = styleMaps.toCloneItems && this._renderOverlay(styleMaps.toCloneItems, styleMaps.clones);
    return (
      <View style={styles.container}>
        <View
          style={styles.scenes}
        >
          {props.scenes.map(
            (scene: *) => this._renderScene({
              ...props,
              scene,
              navigation: this._getChildNavigation(scene),
            }, styleMaps.inPlace)
          )
          }
        </View>
        {floatingHeader}
        {overlay}
      </View>
    );
  }

  _getHeaderMode(): HeaderMode {
    if (this.props.headerMode) {
      return this.props.headerMode;
    }
    if (Platform.OS === 'android' || this.props.mode === 'modal') {
      return 'screen';
    }
    return 'float';
  }

  _getTransitionConfig(
    // props for the new screen
    transitionProps: NavigationTransitionProps,
    // props for the old screen
    prevTransitionProps: NavigationTransitionProps
  ): TransitionConfig {
    const defaultConfig = TransitionConfigs.defaultTransitionConfig(
      transitionProps,
      prevTransitionProps,
      this.props.mode === 'modal'
    );
    if (this.props.transitionConfig) {
      return {
        ...defaultConfig,
        ...this.props.transitionConfig(),
      };
    }

    return defaultConfig;
  }

  _renderInnerCard(
    SceneComponent: ReactClass<*>,
    props: NavigationSceneRendererProps,
  ): React.Element<*> {
    const header = this.props.router.getScreenConfig(props.navigation, 'header');
    const headerMode = this._getHeaderMode();
    if (headerMode === 'screen') {
      const isHeaderHidden = header && header.visible === false;
      const maybeHeader =
        isHeaderHidden ? null : this._renderHeader(props, headerMode);
      return (
        <View style={styles.container}>
          <SceneView
            screenProps={this.props.screenProps}
            navigation={props.navigation}
            component={SceneComponent}
          />
          {maybeHeader}
        </View>
      );
    }
    return (
      <SceneView
        screenProps={this.props.screenProps}
        navigation={props.navigation}
        component={SceneComponent}
      />
    );
  }

  _getChildNavigation = (
    scene: NavigationScene
  ): NavigationScreenProp<*, NavigationAction> => {
    let navigation = this._childNavigationProps[scene.key];
    if (!navigation || navigation.state !== scene.route) {
      navigation = this._childNavigationProps[scene.key] = addNavigationHelpers({
        ...this.props.navigation,
        state: scene.route,
      });
    }
    return navigation;
  }

  _measure(item: TransitionItem): Promise < Metrics > {
    return new Promise((resolve, reject) => {
      UIManager.measureInWindow(
        item.nativeHandle,
        (x, y, width, height) => {
          if ([x, y, width, height].every(n => _.isNumber(n))) {
            resolve({ x, y, width, height });
          } else {
            reject(`x=${x}, y=${y}, width=${width}, height=${height}. The view (${item.toString()}) is not found.  Is it collapsed on Android?`);
          }
        }
      );
    });
  }

  async _onLayout() {
    let toUpdate = [];
    if (this.state.itemsToMeasure) {
      for (let item of this.state.itemsToMeasure) {
        const { id, routeName } = item;
        try {
          const metrics = await this._measure(item);
          toUpdate.push({ id, routeName, metrics });
          // console.log('measured:', id, routeName, metrics);
        } catch (err) {
          console.warn(err);
        }
      }
      if (toUpdate.length > 0) {
        // console.log('measured, setting meatured state:', toUpdate)
        this.setState((prevState: State): State => ({
          transitionItems: prevState.transitionItems.updateMetrics(toUpdate),
          itemsToMeasure: [],
        }));
      }
    }
  }

  _renderScene(props: NavigationSceneRendererProps, transitionStyleMap): React.Element<*> {
    const isModal = this.props.mode === 'modal';

    let panHandlers = null;

    const cardStackConfig = this.props.router.getScreenConfig(
      props.navigation,
      'cardStack'
    ) || {};

    // On iOS, the default behavior is to allow the user to pop a route by
    // swiping the corresponding Card away. On Android this is off by default
    const gesturesEnabledConfig = cardStackConfig.gesturesEnabled;
    const gesturesEnabled = typeof gesturesEnabledConfig === 'boolean' ?
      gesturesEnabledConfig :
      Platform.OS === 'ios';
    if (gesturesEnabled) {
      let onNavigateBack = null;
      if (this.props.navigation.state.index !== 0) {
        onNavigateBack = () => this.props.navigation.dispatch(
          NavigationActions.back({ key: props.scene.route.key })
        );
      }
      const panHandlersProps = {
        ...props,
        onNavigateBack,
        gestureResponseDistance: this.props.gestureResponseDistance,
      };
      panHandlers = isModal ?
        CardStackPanResponder.forVertical(panHandlersProps) :
        CardStackPanResponder.forHorizontal(panHandlersProps);
    }

    const SceneComponent = this.props.router.getComponentForRouteName(props.scene.route.routeName);

    return (
      <Card
        {...props}
        key={`card_${props.scene.key}`}
        onLayout={this._onLayout.bind(this)}
        panHandlers={panHandlers}
        renderScene={(sceneProps: *) => this._renderInnerCard(SceneComponent, sceneProps)}
        style={this.props.cardStyle}
        transitionStyleMap={transitionStyleMap}
      />
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Header is physically rendered after scenes so that Header won't be
    // covered by the shadows of the scenes.
    // That said, we'd have use `flexDirection: 'column-reverse'` to move
    // Header above the scenes.
    flexDirection: 'column-reverse',
  },
  scenes: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    elevation: 100, // make sure it's on the top on Android. TODO is this a legit way?
  },
  clonedItem: {
    position: 'absolute',
  }
});

export default CardStack;
